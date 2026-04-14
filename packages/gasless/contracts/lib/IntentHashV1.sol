// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IIntentTypesV1} from "../interfaces/IIntentTypesV1.sol";

library IntentHashV1 {
    bytes32 internal constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 internal constant CALL_TYPEHASH =
        keccak256("Call(address target,uint256 value,bytes data)");
    bytes32 internal constant INTENT_V1_TYPEHASH =
        keccak256(
            "IntentV1(address account,address sponsor,uint192 nonceKey,uint64 nonceSeq,uint48 validAfter,uint48 validUntil,Call[] calls)Call(address target,uint256 value,bytes data)"
        );

    bytes32 internal constant DOMAIN_NAME_HASH = keccak256(bytes("MoneyOSAccount"));
    bytes32 internal constant DOMAIN_VERSION_HASH = keccak256(bytes("1"));

    function domainSeparator(uint256 chainId, address verifyingContract) internal pure returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    EIP712_DOMAIN_TYPEHASH,
                    DOMAIN_NAME_HASH,
                    DOMAIN_VERSION_HASH,
                    chainId,
                    verifyingContract
                )
            );
    }

    function hashCall(IIntentTypesV1.Call calldata call_) internal pure returns (bytes32) {
        return keccak256(abi.encode(CALL_TYPEHASH, call_.target, call_.value, keccak256(call_.data)));
    }

    function hashCalls(IIntentTypesV1.Call[] calldata calls) internal pure returns (bytes32) {
        bytes32[] memory callHashes = new bytes32[](calls.length);
        for (uint256 i = 0; i < calls.length; i++) {
            callHashes[i] = hashCall(calls[i]);
        }

        return keccak256(abi.encodePacked(callHashes));
    }

    function hashIntentStruct(IIntentTypesV1.IntentV1 calldata intent)
        internal
        pure
        returns (bytes32)
    {
        return
            keccak256(
                abi.encode(
                    INTENT_V1_TYPEHASH,
                    intent.account,
                    intent.sponsor,
                    intent.nonceKey,
                    intent.nonceSeq,
                    intent.validAfter,
                    intent.validUntil,
                    hashCalls(intent.calls)
                )
            );
    }

    function hashTypedData(
        IIntentTypesV1.IntentV1 calldata intent,
        uint256 chainId,
        address verifyingContract
    ) internal pure returns (bytes32) {
        bytes32 ds = domainSeparator(chainId, verifyingContract);
        bytes32 structHash = hashIntentStruct(intent);
        return keccak256(abi.encodePacked("\x19\x01", ds, structHash));
    }
}
