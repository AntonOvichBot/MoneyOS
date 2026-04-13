import {
  getChain,
  getToken,
  getTokenAddress,
  listTokens as listBuiltInTokens,
  NATIVE_TOKEN_ADDRESS,
  type AssetRegistry,
} from "@moneyos/core";

export class DefaultAssetRegistry implements AssetRegistry {
  readonly nativeTokenAddress = NATIVE_TOKEN_ADDRESS;
  getToken = getToken;
  getTokenAddress = getTokenAddress;
  listTokens = listBuiltInTokens;
  getChain = getChain;
}
