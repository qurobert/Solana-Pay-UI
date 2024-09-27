import BigNumber from 'bignumber.js';
import React, { FC, useCallback, useEffect, useMemo, useState } from 'react';
import { usePayment } from '../../hooks/usePayment';
import css from './MemecoinSelection.module.css';

export const MemecoinSelection: FC = () => {
    const [value, setValue] = useState('0');
    const { setAmount } = usePayment();
    useEffect(() => setAmount(value ? new BigNumber(value) : undefined), [setAmount, value]);

    interface Memecoin {
        idx: number;
        name: string;
        price_in_sol: number;
        quantity: number;
        icon: string;
    }

    const initialMemecoins: Memecoin[] = [
        { idx: 0, name: 'BONK', price_in_sol: 0.1, quantity: 0, icon: '🐶' },
        { idx: 1, name: 'FWOG', price_in_sol: 0.05, quantity: 0, icon: '🐸' },
        { idx: 2, name: 'WIF', price_in_sol: 0.02, quantity: 0, icon: '🐕' },
    ]

    const [memecoins, setMemecoins] = useState<Memecoin[]>(initialMemecoins);
    const updateQuantity = (idx: number, newQuantity: number) => {
        setMemecoins(prevMemecoins =>
            prevMemecoins.map(memecoin =>
                memecoin.idx === idx ? { ...memecoin, quantity: newQuantity } : memecoin
            )
        );
    };

    useEffect(() => {
        const totalPrice = memecoins.reduce((sum, memecoin) => sum + (memecoin.price_in_sol * memecoin.quantity), 0);
        setAmount(new BigNumber(totalPrice));
    }, [memecoins, setAmount]);

    const onMinus = (idx: number) => {
        let qty = memecoins[idx].quantity;
        if (qty > 0) {
            updateQuantity(idx, qty - 1);
        }
    };

    const onPlus = (idx: number) => {
        let qty = memecoins[idx].quantity;
        updateQuantity(idx, qty + 1);
    };

    return (
        <div className={css.root}>
            <h1 className={css.title}>🚀 Degen Memecoin Bonanza! 🚀</h1>
            <div className={css.memecoinsContainer}>
                {memecoins.map((memecoin) => (
                    <div key={memecoin.idx} className={css.memecoinCard}>
                        <div className={css.memecoinIcon}>{memecoin.icon}</div>
                        <div className={css.memecoinName}>{memecoin.name}</div>
                        <div className={css.memecoinPrice}>{memecoin.price_in_sol} SOL</div>
                        <div className={css.quantityControl}>
                            <button className={css.quantityButton} onClick={() => onMinus(memecoin.idx)}>-</button>
                            <span className={css.quantity}>{memecoin.quantity}</span>
                            <button className={css.quantityButton} onClick={() => onPlus(memecoin.idx)}>+</button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
