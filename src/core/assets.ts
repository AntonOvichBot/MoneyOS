import {
  getChain,
  getToken,
  getTokenAddress,
  NATIVE_TOKEN_ADDRESS,
  type AssetRegistry,
} from "@moneyos/core";

export class DefaultAssetRegistry implements AssetRegistry {
  readonly nativeTokenAddress = NATIVE_TOKEN_ADDRESS;
  getToken = getToken;
  getTokenAddress = getTokenAddress;
  getChain = getChain;
}
