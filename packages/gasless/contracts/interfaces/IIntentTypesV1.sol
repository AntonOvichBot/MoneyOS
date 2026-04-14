// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IIntentTypesV1 {
    struct Call {
        address target;
        uint256 value;
        bytes data;
    }

    struct IntentV1 {
        address account;
        address sponsor;
        uint192 nonceKey;
        uint64 nonceSeq;
        uint48 validAfter;
        uint48 validUntil;
        Call[] calls;
    }
}
