'use client';

import { useEffect, useState } from 'react';
import { getHorizonUrl } from '../../lib/stellar-config';
import { useWalletStore } from '../../store/wallet-store';
import { TrendingUp, RefreshCw } from 'lucide-react';

export function WalletBalance() {
  const { address, isConnected } = useWalletStore();
  const [xlmBalance, setXlmBalance] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchBalance = async () => {
    if (!address) return;
    setLoading(true);
    try {
      const res = await fetch(`${getHorizonUrl()}/accounts/${address}`);
      if (!res.ok) throw new Error('Account not found');
      const data = await res.json();
      const xlm = data.balances?.find((b: any) => b.asset_type === 'native');
      setXlmBalance(xlm ? parseFloat(xlm.balance).toFixed(2) : '0.00');
    } catch {
      setXlmBalance(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isConnected && address) {
      fetchBalance();
    }
  }, [isConnected, address]);

  if (!isConnected || !address) return null;

  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg">
      <TrendingUp className="w-4 h-4 text-blue-600" />
      <span className="text-sm font-medium text-blue-800">
        {loading ? '...' : xlmBalance !== null ? `${xlmBalance} XLM` : 'Balance unavailable'}
      </span>
      <button
        onClick={fetchBalance}
        className="p-0.5 hover:text-blue-600 transition-colors"
        title="Refresh balance"
      >
        <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
      </button>
    </div>
  );
}
