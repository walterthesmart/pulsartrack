"use client";

// Lazy-load the Stellar SDK so it is never bundled for SSR.
// All SDK types are imported from the package for TypeScript only (erased at runtime).
import type { xdr, rpc } from "@stellar/stellar-sdk";
import {
  getSorobanRpcUrl,
  getNetworkPassphrase,
  CONTRACT_IDS,
} from "./stellar-config";
import { signTx } from "./wallet";
import { useTransactionStore, TransactionType } from "../store/tx-store";

async function getSdk() {
  return import("@stellar/stellar-sdk");
}

export interface ContractCallOptions {
  contractId: string;
  method: string;
  args?: xdr.ScVal[];
  source: string; // Public key of caller
  txType?: TransactionType;
  description?: string;
}

export interface ContractCallResult {
  success: boolean;
  result?: any;
  txHash?: string;
  error?: string;
}

export interface ReadOnlyOptions {
  contractId: string;
  method: string;
  args?: xdr.ScVal[];
}

/**
 * Get Soroban RPC server instance
 */
export async function getSorobanServer() {
  const { rpc } = await getSdk();
  return new rpc.Server(getSorobanRpcUrl(), { allowHttp: false });
}

/**
 * Call a read-only Soroban contract function (simulation only)
 */
export async function callReadOnly(options: ReadOnlyOptions): Promise<any> {
  const { Contract, rpc, TransactionBuilder, BASE_FEE, scValToNative } = await getSdk();
  const server = new rpc.Server(getSorobanRpcUrl(), { allowHttp: false });
  const contract = new Contract(options.contractId);
  const resolvedArgs = await resolveArgs(options.args || []);

  let simulationAccount = process.env.NEXT_PUBLIC_SIMULATION_ACCOUNT;

  if (!simulationAccount) {
    if (process.env.NODE_ENV === "development") {
      simulationAccount =
        "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";
    } else {
      throw new Error(
        "NEXT_PUBLIC_SIMULATION_ACCOUNT environment variable is not set. A source account is required for contract simulations.",
      );
    }
  }

  const account = await server.getAccount(simulationAccount).catch(() => null);

  if (!account) {
    throw new Error("Could not fetch account for read simulation");
  }

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: getNetworkPassphrase(),
  })
    .addOperation(contract.call(options.method, ...resolvedArgs))
    .setTimeout(30)
    .build();

  const simResult = await server.simulateTransaction(tx);

  if (rpc.Api.isSimulationError(simResult)) {
    throw new Error(`Simulation error: ${(simResult as any).error}`);
  }

  if (!rpc.Api.isSimulationSuccess(simResult)) {
    throw new Error("Simulation failed with no result");
  }

  const returnVal = (simResult as rpc.Api.SimulateTransactionSuccessResponse)
    .result?.retval;
  if (!returnVal) return null;

  return scValToNative(returnVal);
}

/**
 * Call a Soroban contract function (requires wallet signing)
 */
export async function callContract(
  options: ContractCallOptions,
): Promise<ContractCallResult> {
  const { Contract, rpc, TransactionBuilder, BASE_FEE, scValToNative } = await getSdk();
  const server = new rpc.Server(getSorobanRpcUrl(), { allowHttp: false });
  const contract = new Contract(options.contractId);

  try {
    const account = await server.getAccount(options.source);
    const resolvedArgs = await resolveArgs(options.args || []);

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: getNetworkPassphrase(),
    })
      .addOperation(contract.call(options.method, ...resolvedArgs))
      .setTimeout(30)
      .build();

    const simResult = await server.simulateTransaction(tx);

    if (rpc.Api.isSimulationError(simResult)) {
      return {
        success: false,
        error: `Simulation failed: ${(simResult as any).error}`,
      };
    }

    const preparedTx = rpc.assembleTransaction(tx, simResult).build();
    const signedXdr = await signTx(preparedTx.toXDR());

    const submitResult = await server.sendTransaction(
      TransactionBuilder.fromXDR(signedXdr, getNetworkPassphrase()) as any,
    );

    if (submitResult.status === "ERROR") {
      return { success: false, error: "Transaction submission failed" };
    }

    const txHash = submitResult.hash;

    const { addTransaction, updateTransaction } =
      useTransactionStore.getState();
    addTransaction({
      txHash,
      type: options.txType || "other",
      status: "pending",
      description: options.description || `${options.method} on contract`,
    });

    for (let i = 0; i < 15; i++) {
      const delay = Math.min(2000 * Math.pow(1.5, i), 10000);
      await new Promise((resolve) => setTimeout(resolve, delay));
      const getResult = await server.getTransaction(txHash);

      if (getResult.status === rpc.Api.GetTransactionStatus.SUCCESS) {
        const returnVal = (
          getResult as rpc.Api.GetSuccessfulTransactionResponse
        ).returnValue;
        const result = returnVal ? scValToNative(returnVal) : null;

        updateTransaction(txHash, { status: "success", result });
        return { success: true, txHash, result };
      }

      if (getResult.status === rpc.Api.GetTransactionStatus.FAILED) {
        updateTransaction(txHash, {
          status: "failed",
          error: "Transaction failed on-chain",
        });
        return { success: false, txHash, error: "Transaction failed on-chain" };
      }
    }

    updateTransaction(txHash, {
      status: "timeout",
      error: "Transaction confirmation timed out — check explorer",
    });
    return { success: false, error: "Transaction polling timeout", txHash };
  } catch (err: any) {
    return { success: false, error: err?.message || "Unknown error" };
  }
}

/**
 * Helper: Convert string to ScVal
 */
export function stringToScVal(value: string): any {
  // Returns a lazy ScVal — resolved when the SDK loads at call time
  return { __type: 'string', value };
}

/**
 * Helper: Convert number to u64 ScVal
 */
export function u64ToScVal(value: number | bigint): any {
  return { __type: 'u64', value: BigInt(value) };
}

/**
 * Helper: Convert number to i128 ScVal
 */
export function i128ToScVal(value: number | bigint): any {
  return { __type: 'i128', value: BigInt(value) };
}

/**
 * Helper: Convert number to u32 ScVal
 */
export function u32ToScVal(value: number): any {
  return { __type: 'u32', value };
}

/**
 * Helper: Convert boolean to ScVal
 */
export function boolToScVal(value: boolean): any {
  return { __type: 'bool', value };
}

/**
 * Helper: Convert Stellar address to ScVal
 */
export function addressToScVal(address: string): any {
  return { __type: 'address', value: address };
}

/**
 * Resolve lazy ScVal descriptors to real xdr.ScVal using the loaded SDK.
 */
async function resolveArgs(args: any[]): Promise<any[]> {
  const { nativeToScVal, Address } = await getSdk();
  return args.map((arg) => {
    if (!arg || typeof arg.__type === 'undefined') return arg;
    switch (arg.__type) {
      case 'string': return nativeToScVal(arg.value, { type: 'string' });
      case 'u64': return nativeToScVal(arg.value, { type: 'u64' });
      case 'i128': return nativeToScVal(arg.value, { type: 'i128' });
      case 'u32': return nativeToScVal(arg.value, { type: 'u32' });
      case 'bool': return nativeToScVal(arg.value, { type: 'bool' });
      case 'address': return new Address(arg.value).toScVal();
      default: return arg;
    }
  });
}
