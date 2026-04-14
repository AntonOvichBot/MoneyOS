// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IntentHashV1} from "../contracts/lib/IntentHashV1.sol";
import {IIntentTypesV1} from "../contracts/interfaces/IIntentTypesV1.sol";

contract IntentHashHarness {
    function hash(
        IIntentTypesV1.IntentV1 calldata intent,
        uint256 chainId,
        address verifyingContract
    ) external pure returns (bytes32) {
        return IntentHashV1.hashTypedData(intent, chainId, verifyingContract);
    }
}

contract IntentHashV1Test {
    function testGoldenHashVector() public {
        IntentHashHarness harness = new IntentHashHarness();

        IIntentTypesV1.Call[] memory calls = new IIntentTypesV1.Call[](1);
        calls[0] = IIntentTypesV1.Call({
            target: 0x3333333333333333333333333333333333333333,
            value: 123456789000000,
            data: ""
        });

        IIntentTypesV1.IntentV1 memory intent = IIntentTypesV1.IntentV1({
            account: 0x1111111111111111111111111111111111111111,
            sponsor: 0x2222222222222222222222222222222222222222,
            nonceKey: 7,
            nonceSeq: 3,
            validAfter: 1710000000,
            validUntil: 1710000300,
            calls: calls
        });

        bytes32 digest = harness.hash(
            intent,
            42161,
            0x1111111111111111111111111111111111111111
        );

        require(
            digest ==
                0x371dd330d830b05908d5288d25d27fcdff3228919c2be9cca13d4d81a1776ff0,
            "golden digest mismatch"
        );
    }
}
