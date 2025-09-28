/**
 * Sample TypeScript React application for Web3 frontend
 * Demonstrates modern React patterns with Web3 integration
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { ethers, BigNumber, providers, Contract } from 'ethers';

// Types and interfaces
interface WalletState {
  address: string | null;
  balance: string | null;
  isConnected: boolean;
  chainId: number | null;
}

interface TokenInfo {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  balance: BigNumber;
}

interface TransactionState {
  hash: string | null;
  status: 'pending' | 'confirmed' | 'failed' | null;
  gasUsed: string | null;
}

// Constants
const SUPPORTED_CHAINS = {
  1: 'Ethereum Mainnet',
  5: 'Goerli Testnet',
  11155111: 'Sepolia Testnet',
} as const;

const ERC20_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'event Transfer(address indexed from, address indexed to, uint256 value)'
];

// Custom hooks
function useWallet() {
  const [walletState, setWalletState] = useState<WalletState>({
    address: null,
    balance: null,
    isConnected: false,
    chainId: null,
  });

  const [provider, setProvider] = useState<providers.Web3Provider | null>(null);

  const connectWallet = useCallback(async () => {
    try {
      if (!window.ethereum) {
        throw new Error('MetaMask not installed');
      }

      const web3Provider = new providers.Web3Provider(window.ethereum);
      const accounts = await web3Provider.send('eth_requestAccounts', []);
      const network = await web3Provider.getNetwork();
      const balance = await web3Provider.getBalance(accounts[0]);

      setProvider(web3Provider);
      setWalletState({
        address: accounts[0],
        balance: ethers.utils.formatEther(balance),
        isConnected: true,
        chainId: network.chainId,
      });
    } catch (error) {
      console.error('Failed to connect wallet:', error);
    }
  }, []);

  const disconnectWallet = useCallback(() => {
    setWalletState({
      address: null,
      balance: null,
      isConnected: false,
      chainId: null,
    });
    setProvider(null);
  }, []);

  useEffect(() => {
    if (window.ethereum) {
      window.ethereum.on('accountsChanged', (accounts: string[]) => {
        if (accounts.length === 0) {
          disconnectWallet();
        }
      });

      window.ethereum.on('chainChanged', () => {
        window.location.reload();
      });
    }
  }, [disconnectWallet]);

  return {
    walletState,
    provider,
    connectWallet,
    disconnectWallet,
  };
}

function useTokenContract(tokenAddress: string, provider: providers.Web3Provider | null) {
  const contract = useMemo(() => {
    if (!provider || !tokenAddress) return null;
    return new Contract(tokenAddress, ERC20_ABI, provider);
  }, [tokenAddress, provider]);

  const getTokenInfo = useCallback(async (userAddress: string): Promise<TokenInfo | null> => {
    if (!contract || !userAddress) return null;

    try {
      const [name, symbol, decimals, balance] = await Promise.all([
        contract.name(),
        contract.symbol(),
        contract.decimals(),
        contract.balanceOf(userAddress),
      ]);

      return {
        address: tokenAddress,
        name,
        symbol,
        decimals,
        balance,
      };
    } catch (error) {
      console.error('Failed to fetch token info:', error);
      return null;
    }
  }, [contract, tokenAddress]);

  return { contract, getTokenInfo };
}

// Components
const WalletConnect: React.FC<{
  walletState: WalletState;
  onConnect: () => void;
  onDisconnect: () => void;
}> = ({ walletState, onConnect, onDisconnect }) => {
  const { address, balance, isConnected, chainId } = walletState;

  const chainName = chainId ? SUPPORTED_CHAINS[chainId as keyof typeof SUPPORTED_CHAINS] : 'Unknown';

  if (!isConnected) {
    return (
      <button
        onClick={onConnect}
        className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
      >
        Connect Wallet
      </button>
    );
  }

  return (
    <div className="bg-gray-100 p-4 rounded-lg">
      <div className="mb-2">
        <strong>Address:</strong> {address?.slice(0, 6)}...{address?.slice(-4)}
      </div>
      <div className="mb-2">
        <strong>Balance:</strong> {parseFloat(balance || '0').toFixed(4)} ETH
      </div>
      <div className="mb-2">
        <strong>Network:</strong> {chainName}
      </div>
      <button
        onClick={onDisconnect}
        className="bg-red-500 hover:bg-red-700 text-white font-bold py-2 px-4 rounded"
      >
        Disconnect
      </button>
    </div>
  );
};

const TokenBalance: React.FC<{
  tokenAddress: string;
  userAddress: string;
  provider: providers.Web3Provider | null;
}> = ({ tokenAddress, userAddress, provider }) => {
  const [tokenInfo, setTokenInfo] = useState<TokenInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const { getTokenInfo } = useTokenContract(tokenAddress, provider);

  useEffect(() => {
    let isMounted = true;

    const fetchTokenInfo = async () => {
      if (!userAddress || !provider) return;

      setLoading(true);
      try {
        const info = await getTokenInfo(userAddress);
        if (isMounted) {
          setTokenInfo(info);
        }
      } catch (error) {
        console.error('Failed to fetch token info:', error);
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    fetchTokenInfo();

    return () => {
      isMounted = false;
    };
  }, [tokenAddress, userAddress, provider, getTokenInfo]);

  if (loading) {
    return <div className="animate-pulse">Loading token info...</div>;
  }

  if (!tokenInfo) {
    return <div className="text-red-500">Failed to load token</div>;
  }

  const formattedBalance = ethers.utils.formatUnits(tokenInfo.balance, tokenInfo.decimals);

  return (
    <div className="border p-4 rounded-lg">
      <h3 className="font-bold text-lg">{tokenInfo.name} ({tokenInfo.symbol})</h3>
      <p>Balance: {parseFloat(formattedBalance).toFixed(6)}</p>
      <p className="text-sm text-gray-500">Contract: {tokenInfo.address}</p>
    </div>
  );
};

const TransactionForm: React.FC<{
  provider: providers.Web3Provider | null;
  userAddress: string | null;
}> = ({ provider, userAddress }) => {
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [txState, setTxState] = useState<TransactionState>({
    hash: null,
    status: null,
    gasUsed: null,
  });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!provider || !userAddress) return;

    setLoading(true);
    try {
      const signer = provider.getSigner();
      const tx = await signer.sendTransaction({
        to: recipient,
        value: ethers.utils.parseEther(amount),
      });

      setTxState({
        hash: tx.hash,
        status: 'pending',
        gasUsed: null,
      });

      const receipt = await tx.wait();
      setTxState({
        hash: tx.hash,
        status: receipt.status === 1 ? 'confirmed' : 'failed',
        gasUsed: receipt.gasUsed.toString(),
      });
    } catch (error) {
      console.error('Transaction failed:', error);
      setTxState({
        hash: null,
        status: 'failed',
        gasUsed: null,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white p-6 rounded-lg shadow-lg">
      <h2 className="text-xl font-bold mb-4">Send Transaction</h2>
      
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700">Recipient Address</label>
          <input
            type="text"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            className="mt-1 block w-full border-gray-300 rounded-md shadow-sm"
            placeholder="0x..."
            required
          />
        </div>
        
        <div>
          <label className="block text-sm font-medium text-gray-700">Amount (ETH)</label>
          <input
            type="number"
            step="0.001"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="mt-1 block w-full border-gray-300 rounded-md shadow-sm"
            placeholder="0.1"
            required
          />
        </div>
        
        <button
          type="submit"
          disabled={loading || !userAddress}
          className="w-full bg-green-500 hover:bg-green-700 text-white font-bold py-2 px-4 rounded disabled:opacity-50"
        >
          {loading ? 'Sending...' : 'Send Transaction'}
        </button>
      </form>

      {txState.hash && (
        <div className="mt-4 p-4 bg-gray-50 rounded">
          <h3 className="font-medium">Transaction Status</h3>
          <p>Hash: {txState.hash}</p>
          <p>Status: <span className={`font-medium ${
            txState.status === 'confirmed' ? 'text-green-600' :
            txState.status === 'failed' ? 'text-red-600' : 'text-yellow-600'
          }`}>{txState.status}</span></p>
          {txState.gasUsed && <p>Gas Used: {txState.gasUsed}</p>}
        </div>
      )}
    </div>
  );
};

// Main App component
const App: React.FC = () => {
  const { walletState, provider, connectWallet, disconnectWallet } = useWallet();

  const popularTokens = [
    '0xA0b86a33E6441b8435B3b5a47c3bBc1e7d5b2e0f', // USDC
    '0xdAC17F958D2ee523a2206206994597C13D831ec7', // USDT
    '0x6B175474E89094C44Da98b954EedeAC495271d0F', // DAI
  ];

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto px-4">
        <header className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Web3 Wallet Dashboard</h1>
          <p className="text-gray-600 mt-2">Connect your wallet and manage your assets</p>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div>
            <WalletConnect
              walletState={walletState}
              onConnect={connectWallet}
              onDisconnect={disconnectWallet}
            />

            {walletState.isConnected && (
              <div className="mt-6">
                <h2 className="text-xl font-bold mb-4">Token Balances</h2>
                <div className="space-y-4">
                  {popularTokens.map((tokenAddress) => (
                    <TokenBalance
                      key={tokenAddress}
                      tokenAddress={tokenAddress}
                      userAddress={walletState.address!}
                      provider={provider}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          <div>
            <TransactionForm
              provider={provider}
              userAddress={walletState.address}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;

// Additional utility functions
export const utils = {
  formatAddress: (address: string): string => {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  },

  formatBalance: (balance: BigNumber, decimals: number, displayDecimals: number = 4): string => {
    const formatted = ethers.utils.formatUnits(balance, decimals);
    return parseFloat(formatted).toFixed(displayDecimals);
  },

  isValidAddress: (address: string): boolean => {
    return ethers.utils.isAddress(address);
  },

  parseError: (error: any): string => {
    if (error.code === 4001) {
      return 'Transaction was rejected by user';
    }
    if (error.code === -32603) {
      return 'Internal error occurred';
    }
    return error.message || 'Unknown error occurred';
  },
};

// Type declarations for window.ethereum
declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: any[] }) => Promise<any>;
      on: (event: string, handler: (...args: any[]) => void) => void;
      removeListener: (event: string, handler: (...args: any[]) => void) => void;
    };
  }
}


