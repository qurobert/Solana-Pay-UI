import {
    createTransfer,
    encodeURL,
    fetchTransaction,
    findReference,
    FindReferenceError,
    parseURL,
    validateTransfer,
    ValidateTransferError,
} from '@solana/pay';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { ConfirmedSignatureInfo, Keypair, PublicKey, Transaction, TransactionSignature } from '@solana/web3.js';
import BigNumber from 'bignumber.js';
import { useRouter } from 'next/router';
import React, { FC, ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { useConfig } from '../../hooks/useConfig';
import { useNavigateWithQuery } from '../../hooks/useNavigateWithQuery';
import { PaymentContext, PaymentStatus } from '../../hooks/usePayment';
import { Confirmations } from '../../types';

export interface PaymentProviderProps {
    children: ReactNode;
}

export const PaymentProvider: FC<PaymentProviderProps> = ({ children }) => {
    const { connection } = useConnection();
    const { recipient, splToken, label, message } = useConfig();
    const [amount, setAmount] = useState<BigNumber | undefined>();
    const [memo, setMemo] = useState<string>();
    const [reference, setReference] = useState<PublicKey>();
    const [status, setStatus] = useState(PaymentStatus.New);
    const navigate = useNavigateWithQuery();

    const url = useMemo(() => {
        if (!amount || !reference) return;
        return encodeURL({
            recipient,
            amount,
            splToken,
            reference,
            label,
            message,
            memo,
        });
    }, [amount, recipient, splToken, reference, label, message, memo]);

    const reset = useCallback(() => {
        setAmount(undefined);
        setMemo(undefined);
        setReference(undefined);
        setStatus(PaymentStatus.New);
        navigate('/new', true);
    }, [navigate]);

    const generate = useCallback(() => {
        if (status === PaymentStatus.New && !reference) {
            setReference(Keypair.generate().publicKey);
            setStatus(PaymentStatus.Pending);
            navigate('/pending');
        }
    }, [status, reference, navigate]);

    useEffect(() => {
        if (status !== PaymentStatus.Pending || !reference) return;

        const checkTransaction = async () => {
            try {
                const signatureInfo = await findReference(connection, reference);
                if (signatureInfo) {
                    const txStatus = await connection.getSignatureStatus(signatureInfo.signature);
                    if (txStatus.value?.confirmationStatus === 'confirmed' || txStatus.value?.confirmationStatus === 'finalized') {
                        setStatus(PaymentStatus.Confirmed);
                        navigate('/confirmed', true);
                    }
                }
            } catch (error) {
                if (!(error instanceof FindReferenceError)) {
                    console.error(error);
                }
            }
        };

        const interval = setInterval(checkTransaction, 5000);
        return () => clearInterval(interval);
    }, [status, reference, connection, navigate]);

    return (
        <PaymentContext.Provider
            value={{
                amount,
                setAmount,
                memo,
                setMemo,
                reference,
                status,
                url,
                reset,
                generate,
            }}
        >
            {children}
        </PaymentContext.Provider>
    );
};
