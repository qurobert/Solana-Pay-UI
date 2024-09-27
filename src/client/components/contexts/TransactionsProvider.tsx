import { getAssociatedTokenAddress } from '@solana/spl-token';
import { useConnection } from '@solana/wallet-adapter-react';
import {
    LAMPORTS_PER_SOL,
    ParsedTransactionWithMeta,
    PublicKey,
    RpcResponseAndContext,
    SignatureStatus,
    TransactionSignature,
} from '@solana/web3.js';
import BigNumber from 'bignumber.js';
import React, { FC, ReactNode, useEffect, useState } from 'react';
import { useConfig } from '../../hooks/useConfig';
import { Transaction, TransactionsContext } from '../../hooks/useTransactions';
import { Confirmations } from '../../types';
import { arraysEqual } from '../../utils/arraysEqual';
import { MAX_CONFIRMATIONS } from '../../utils/constants';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const exponentialBackoff = async (fn: () => Promise<void>, maxRetries = 5, initialDelay = 1000): Promise<boolean> => {
    for (let i = 0; i < maxRetries; i++) {
      try {
        await fn();
        return true;
      } catch (error) {
        if (i === maxRetries - 1) return false;
        await delay(initialDelay * Math.pow(2, i));
      }
    }
    return false;
  };

export interface TransactionsProviderProps {
    children: ReactNode;
    pollInterval?: number;
}

export const TransactionsProvider: FC<TransactionsProviderProps> = ({ children, pollInterval }) => {
    pollInterval ||= 20000;

    const { connection } = useConnection();
    const { recipient, splToken } = useConfig();
    const [associatedToken, setAssociatedToken] = useState<PublicKey>();
    const [signatures, setSignatures] = useState<TransactionSignature[]>([]);
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [loading, setLoading] = useState(false);

    // Get the ATA for the recipient and token
    useEffect(() => {
        if (!splToken) {
            return;
        }

        let changed = false;

        (async () => {
            const associatedToken = await getAssociatedTokenAddress(splToken, recipient);
            if (changed) return;

            setAssociatedToken(associatedToken);
        })();

        return () => {
            changed = true;
            setAssociatedToken(undefined);
        };
    }, [splToken, recipient]);

    // Poll for signatures referencing the associated token account
    useEffect(() => {
        let changed = false;
        let currentDelay = 1000;
    
        const run = async () => {
            const success = await exponentialBackoff(async () => {
                setLoading(true);
                const confirmedSignatureInfos = await connection.getSignaturesForAddress(
                    associatedToken || recipient,
                    { limit: 10 },
                    'confirmed'
                );
                if (changed) return;
    
                setSignatures((prevSignatures) => {
                    const nextSignatures = confirmedSignatureInfos.map(({ signature }) => signature);
                    return arraysEqual(prevSignatures, nextSignatures) ? prevSignatures : nextSignatures;
                });
                setLoading(false);
            }, 5, currentDelay);
    
            if (success) {
                currentDelay = 1000; // Reset delay on success
            } else {
                currentDelay = Math.min(currentDelay * 2, 30000); // Cap at 30 seconds
            }
    
            if (!changed) {
                setTimeout(run, currentDelay);
            }
        };
    
        void run();
    
        return () => {
            changed = true;
            setSignatures([]);
        };
    }, [connection, associatedToken, recipient]);

    // When the signatures change, poll and update the transactions
    useEffect(() => {
        if (!signatures.length) return;
        let changed = false;
        let currentDelay = 1000;
    
        const run = async () => {
            const success = await exponentialBackoff(async () => {
                setLoading(true);
                const [parsedTransactions, signatureStatuses] = await Promise.all([
                    connection.getParsedTransactions(signatures),
                    connection.getSignatureStatuses(signatures, { searchTransactionHistory: true }),
                ]);
                if (changed) return;

            setTransactions(
                signatures
                    .map((signature, signatureIndex): Transaction | undefined => {
                        const parsedTransaction = parsedTransactions[signatureIndex];
                        const signatureStatus = signatureStatuses.value[signatureIndex];
                        if (!parsedTransaction?.meta || !signatureStatus) return;

                        const timestamp = parsedTransaction.blockTime;
                        const error = parsedTransaction.meta.err;
                        const status = signatureStatus.confirmationStatus;
                        if (!timestamp || !status) return;

                        if (parsedTransaction.transaction.message.instructions.length !== 1) return;
                        const instruction = parsedTransaction.transaction.message.instructions[0];
                        if (!('program' in instruction)) return;
                        const program = instruction.program;
                        const type = instruction.parsed?.type;
                        const info = instruction.parsed.info;

                        let preAmount: BigNumber, postAmount: BigNumber;
                        if (!associatedToken) {
                            // Include only SystemProgram.transfer instructions
                            if (!(program === 'system' && type === 'transfer')) return;

                            // Include only transfers to the recipient
                            if (info?.destination !== recipient.toBase58()) return;

                            // Exclude self-transfers
                            if (info.source === recipient.toBase58()) return;

                            const accountIndex = parsedTransaction.transaction.message.accountKeys.findIndex(
                                ({ pubkey }) => pubkey.equals(recipient)
                            );
                            if (accountIndex === -1) return;

                            const preBalance = parsedTransaction.meta.preBalances[accountIndex];
                            const postBalance = parsedTransaction.meta.postBalances[accountIndex];

                            preAmount = new BigNumber(preBalance).div(LAMPORTS_PER_SOL);
                            postAmount = new BigNumber(postBalance).div(LAMPORTS_PER_SOL);
                        } else {
                            // Include only TokenProgram.transfer / TokenProgram.transferChecked instructions
                            if (!(program === 'spl-token' && (type === 'transfer' || type === 'transferChecked')))
                                return;

                            // Include only transfers to the recipient ATA
                            if (info?.destination !== associatedToken.toBase58()) return;

                            // Exclude self-transfers
                            if (info.source === associatedToken.toBase58()) return;

                            const accountIndex = parsedTransaction.transaction.message.accountKeys.findIndex(
                                ({ pubkey }) => pubkey.equals(associatedToken)
                            );
                            if (accountIndex === -1) return;

                            const preBalance = parsedTransaction.meta.preTokenBalances?.find(
                                (x) => x.accountIndex === accountIndex
                            );
                            if (!preBalance?.uiTokenAmount.uiAmountString) return;

                            const postBalance = parsedTransaction.meta.postTokenBalances?.find(
                                (x) => x.accountIndex === accountIndex
                            );
                            if (!postBalance?.uiTokenAmount.uiAmountString) return;

                            preAmount = new BigNumber(preBalance.uiTokenAmount.uiAmountString);
                            postAmount = new BigNumber(postBalance.uiTokenAmount.uiAmountString);
                        }

                        // Exclude negative amounts
                        if (postAmount.lt(preAmount)) return;

                        const amount = postAmount.minus(preAmount).toString();
                        const confirmations =
                            status === 'finalized'
                                ? MAX_CONFIRMATIONS
                                : ((signatureStatus.confirmations || 0) as Confirmations);

                        return {
                            signature,
                            amount,
                            timestamp,
                            error,
                            status,
                            confirmations,
                        };
                    })
                    .filter((transaction): transaction is Transaction => !!transaction)
            );
            setLoading(false);
        }, 5, currentDelay);

        if (success) {
            currentDelay = 1000; // Reset delay on success
        } else {
            currentDelay = Math.min(currentDelay * 2, 30000); // Cap at 30 seconds
        }

        if (!changed) {
            setTimeout(run, currentDelay);
        }
    };

    void run();

    return () => {
        changed = true;
    };
}, [signatures, connection, associatedToken, recipient]);

    return <TransactionsContext.Provider value={{ transactions, loading }}>{children}</TransactionsContext.Provider>;
};
