// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MoneyOSAccountFactoryV1} from "../contracts/MoneyOSAccountFactoryV1.sol";
import {IntentHashV1} from "../contracts/lib/IntentHashV1.sol";
import {IIntentTypesV1} from "../contracts/interfaces/IIntentTypesV1.sol";

interface Vm {
    function addr(uint256 privateKey) external returns (address);
    function sign(uint256 privateKey, bytes32 digest) external returns (uint8 v, bytes32 r, bytes32 s);
    function prank(address newSender) external;
}

address constant HEVM_ADDRESS = address(uint160(uint256(keccak256("hevm cheat code"))));
Vm constant vm = Vm(HEVM_ADDRESS);

contract IntentHashHarnessForFactory {
    function hash(
        IIntentTypesV1.IntentV1 calldata intent,
        uint256 chainId,
        address verifyingContract
    ) external pure returns (bytes32) {
        return IntentHashV1.hashTypedData(intent, chainId, verifyingContract);
    }
}

contract ReceiverFactory {
    receive() external payable {}
}

contract MockToken {
    mapping(address owner => mapping(address spender => uint256 allowance)) public allowances;

    function approve(address spender, uint256 amount) external returns (bool) {
        allowances[msg.sender][spender] = amount;
        return true;
    }
}

contract MockSwapRouter {
    bool public called;
    address public lastCaller;

    function swap(bytes calldata) external returns (bytes32) {
        called = true;
        lastCaller = msg.sender;
        return keccak256("swapped");
    }
}

contract MoneyOSAccountFactoryV1Test {
    uint256 internal constant OWNER_PK = 0xA11CE;

    MoneyOSAccountFactoryV1 internal factory;
    IntentHashHarnessForFactory internal hashHarness;
    ReceiverFactory internal receiver;
    MockToken internal token;
    MockSwapRouter internal router;

    address internal owner;
    address internal sponsor;

    function setUp() public {
        owner = vm.addr(OWNER_PK);
        sponsor = address(0xBEEF);

        factory = new MoneyOSAccountFactoryV1();
        hashHarness = new IntentHashHarnessForFactory();
        receiver = new ReceiverFactory();
        token = new MockToken();
        router = new MockSwapRouter();
    }

    function testComputeAddressMatchesDeployment() public {
        bytes32 salt = keccak256("moneyos-account-v1");
        address predicted = factory.computeAccountAddress(owner, salt);
        address deployed = factory.deployAccount(owner, salt);

        require(predicted == deployed, "create2 prediction mismatch");
        require(factory.deployAccount(owner, salt) == deployed, "deploy should be idempotent");
    }

    function testDeployAndExecuteNativeSend() public {
        bytes32 salt = keccak256("native-send");
        address predicted = factory.computeAccountAddress(owner, salt);

        IIntentTypesV1.Call[] memory calls = new IIntentTypesV1.Call[](1);
        calls[0] = IIntentTypesV1.Call({
            target: address(receiver),
            value: 0.2 ether,
            data: ""
        });

        IIntentTypesV1.IntentV1 memory intent = IIntentTypesV1.IntentV1({
            account: predicted,
            sponsor: sponsor,
            nonceKey: 1,
            nonceSeq: 0,
            validAfter: uint48(block.timestamp),
            validUntil: uint48(block.timestamp + 300),
            calls: calls
        });

        bytes memory signature = _signIntent(intent, predicted);
        uint256 beforeBalance = address(receiver).balance;

        vm.prank(sponsor);
        (address account,) = factory.deployAndExecute{value: 0.2 ether}(owner, salt, intent, signature);

        require(account == predicted, "unexpected deployed account");
        require(address(receiver).balance == beforeBalance + 0.2 ether, "receiver did not receive native value");
    }

    function testDeployAndExecuteAtomicApproveAndSwap() public {
        bytes32 salt = keccak256("atomic-swap");
        address predicted = factory.computeAccountAddress(owner, salt);

        IIntentTypesV1.Call[] memory calls = new IIntentTypesV1.Call[](2);
        calls[0] = IIntentTypesV1.Call({
            target: address(token),
            value: 0,
            data: abi.encodeWithSelector(MockToken.approve.selector, address(router), 777)
        });
        calls[1] = IIntentTypesV1.Call({
            target: address(router),
            value: 0,
            data: abi.encodeWithSelector(MockSwapRouter.swap.selector, bytes("route-payload"))
        });

        IIntentTypesV1.IntentV1 memory intent = IIntentTypesV1.IntentV1({
            account: predicted,
            sponsor: sponsor,
            nonceKey: 2,
            nonceSeq: 0,
            validAfter: uint48(block.timestamp),
            validUntil: uint48(block.timestamp + 300),
            calls: calls
        });

        bytes memory signature = _signIntent(intent, predicted);

        vm.prank(sponsor);
        (address account,) = factory.deployAndExecute(owner, salt, intent, signature);

        require(account == predicted, "unexpected deployed account");
        require(token.allowances(predicted, address(router)) == 777, "approve amount mismatch");
        require(router.called(), "router was not called");
        require(router.lastCaller() == predicted, "router caller must be account");
    }

    function _signIntent(IIntentTypesV1.IntentV1 memory intent, address verifyingContract)
        internal
        returns (bytes memory signature)
    {
        bytes32 digest = hashHarness.hash(intent, block.chainid, verifyingContract);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(OWNER_PK, digest);
        signature = abi.encodePacked(r, s, v);
    }
}
