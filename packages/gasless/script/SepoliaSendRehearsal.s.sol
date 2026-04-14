// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IIntentTypesV1} from "../contracts/interfaces/IIntentTypesV1.sol";
import {MoneyOSAccountFactoryV1} from "../contracts/MoneyOSAccountFactoryV1.sol";
import {IntentHashV1} from "../contracts/lib/IntentHashV1.sol";

interface Vm {
    function envUint(string calldata name) external returns (uint256);
    function addr(uint256 privateKey) external returns (address);
    function sign(uint256 privateKey, bytes32 digest) external returns (uint8 v, bytes32 r, bytes32 s);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

address constant HEVM_ADDRESS = address(uint160(uint256(keccak256("hevm cheat code"))));
Vm constant vm = Vm(HEVM_ADDRESS);

contract ReceiverSepoliaHarness {
    receive() external payable {}
}

contract IntentHashHarnessScript {
    function hash(IIntentTypesV1.IntentV1 calldata intent, uint256 chainId, address verifyingContract)
        external
        pure
        returns (bytes32)
    {
        return IntentHashV1.hashTypedData(intent, chainId, verifyingContract);
    }
}

contract SepoliaSendRehearsalScript {
    error WrongChain(uint256 chainId);

    uint256 internal constant SEPOLIA_CHAIN_ID = 11155111;
    bytes32 internal constant SEND_SALT = keccak256("moneyos-gasless-v1-sepolia-send");
    uint192 internal constant NONCE_KEY = 1;
    uint64 internal constant NONCE_SEQ = 0;
    uint256 internal constant SEND_WEI = 0.0001 ether;
    uint48 internal constant INTENT_WINDOW_SECONDS = 600;

    event SendRehearsed(
        address indexed sponsor,
        address indexed owner,
        address factory,
        address account,
        address receiver,
        uint256 amountWei
    );

    function run() external returns (address factoryAddress, address accountAddress, address receiverAddress) {
        if (block.chainid != SEPOLIA_CHAIN_ID) {
            revert WrongChain(block.chainid);
        }

        uint256 sponsorPk = vm.envUint("SEPOLIA_SPONSOR_PK");
        uint256 ownerPk = vm.envUint("SEPOLIA_OWNER_PK");

        address sponsor = vm.addr(sponsorPk);
        address owner = vm.addr(ownerPk);

        vm.startBroadcast(sponsorPk);

        MoneyOSAccountFactoryV1 factory = new MoneyOSAccountFactoryV1();
        ReceiverSepoliaHarness receiver = new ReceiverSepoliaHarness();
        IntentHashHarnessScript hashHarness = new IntentHashHarnessScript();

        address predicted = factory.computeAccountAddress(owner, SEND_SALT);

        IIntentTypesV1.Call[] memory calls = new IIntentTypesV1.Call[](1);
        calls[0] = IIntentTypesV1.Call({target: address(receiver), value: SEND_WEI, data: ""});

        IIntentTypesV1.IntentV1 memory intent = IIntentTypesV1.IntentV1({
            account: predicted,
            sponsor: sponsor,
            nonceKey: NONCE_KEY,
            nonceSeq: NONCE_SEQ,
            validAfter: uint48(block.timestamp),
            validUntil: uint48(block.timestamp + INTENT_WINDOW_SECONDS),
            calls: calls
        });

        bytes memory signature = _signIntent(ownerPk, intent, predicted, hashHarness);
        uint256 receiverBefore = address(receiver).balance;

        (address account,) = factory.deployAndExecute{value: SEND_WEI}(owner, SEND_SALT, intent, signature);

        require(account == predicted, "unexpected account");
        require(address(receiver).balance == receiverBefore + SEND_WEI, "native send failed");

        vm.stopBroadcast();

        emit SendRehearsed(sponsor, owner, address(factory), account, address(receiver), SEND_WEI);

        return (address(factory), account, address(receiver));
    }

    function _signIntent(
        uint256 ownerPk,
        IIntentTypesV1.IntentV1 memory intent,
        address verifyingContract,
        IntentHashHarnessScript hashHarness
    ) internal returns (bytes memory signature) {
        bytes32 digest = hashHarness.hash(intent, block.chainid, verifyingContract);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerPk, digest);
        signature = abi.encodePacked(r, s, v);
    }
}
