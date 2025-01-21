import {FeeBumpTransaction} from "@stellar/stellar-sdk";

export default class StellarBrokerClient {
    /**
     * @param {ClientInitializationParams} params
     */
    constructor(params: ClientInitializationParams);

    /**
     * Trader account public key
     * @type {string}
     */
    readonly source: string;
    /**
     * Stellar network passphrase
     * @type {string}
     */
    readonly network: string;
    /**
     * @type {ClientStatus}
     */
    readonly status: ClientStatus;

    /**
     * Connect to the StellarBroker server
     * @return {Promise<StellarBrokerClient>}
     */
    connect(): Promise<StellarBrokerClient>;

    /**
     * Request swap quote
     * @param {SwapQuoteParams} params - Quote parameters
     */
    quote(params: SwapQuoteParams): void;

    /**
     * Stop quotation/trading
     */
    stop(): void;

    /**
     * Confirm current quote and start trading
     * @param {string} account - Trader account address
     * @param {string|ClientAuthorizationCallback} authorization - Authorization method, either account secret key or an authorization callback
     */
    confirmQuote(account: string, authorization: string | ClientAuthorizationCallback): void;

    /**
     * Add event listener
     * @param {StellarBrokerClientEvent} type
     * @param {function} callback
     */
    on(type: StellarBrokerClientEvent, callback: Function): void;

    /**
     * Add event listener that will be executed once
     * @param {StellarBrokerClientEvent} type
     * @param {function} callback
     */
    once(type: StellarBrokerClientEvent, callback: Function): void;

    /**
     * Remove event listener
     * @param {StellarBrokerClientEvent} type
     * @param {function} callback
     */
    off(type: StellarBrokerClientEvent, callback: Function): void;

    /**
     * Close underlying connection and finalize the client
     */
    close(): void;
}

/**
 * Request single swap quote estimate without trading
 */
export function estimateSwap(params: SwapQuoteParams): Promise<SwapQuoteResult>;

export interface SwapQuoteParams {
    /**
     * Asset to sell
     */
    sellingAsset: string
    /**
     * Asset to buy
     */
    buyingAsset: string
    /**
     * Amount of selling asset
     */
    sellingAmount?: string
    /**
     * Amount of buying asset
     */
    buyingAmount?: string
    /**
     * Swap slippage tolerance (2% by default)
     */
    slippageTolerance?: number
}


export interface ClientInitializationParams {
    /**
     * Partner key
     */
    partnerKey?: string;
    /**
     * Stellar network identifier or passphrase (pubnet by default)
     */
    network?: string;
}

export type ClientStatus = "disconnected" | "ready" | "quote" | "trade";

export type StellarBrokerClientEvent = "quote" | "finished" | "progress" | "error";

export interface SwapQuoteResult {
    sellingAsset: string;
    buyingAsset: string;
    slippageTolerance: number;
    destination: string;
    ledger: number;
    sellingAmount?: string;
    estimatedBuyingAmount?: string;
    buyingAmount?: string;
    estimatedSellingAmount?: string;
    directTrade?: SwapQuoteDirectTradeResult;
}

export interface SwapQuoteDirectTradeResult {
    selling: string;
    buying: string;
    path: string[];
}

export class StellarBrokerError extends Error {
    /**
     * Numeric error code
     * @type {number}
     * @readonly
     */
    readonly code: number;
}

export type ClientAuthorizationCallback = (arg0: FeeBumpTransaction) => Promise<FeeBumpTransaction>;
