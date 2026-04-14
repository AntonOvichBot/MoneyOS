// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MoneyOSAccountV1} from "../contracts/MoneyOSAccountV1.sol";
import {IntentHashV1} from "../contracts/lib/IntentHashV1.sol";
import {IIntentTypesV1} from "../contracts/interfaces/IIntentTypesV1.sol";

interface Vm {
    function addr(uint256 privateKey) external returns (address);
    function sign(uint256 privateKey, bytes32 digest) external returns (uint8 v, bytes32 r, bytes32 s);
    function prank(address newSender) external;
    function expectRevert(bytes4) external;
    function expectRevert(bytes calldata) external;
    function warp(uint256) external;
}

address constant HEVM_ADDRESS = address(uint160(uint256(keccak256("hevm cheat code"))));
Vm constant vm = Vm(HEVM_ADDRESS);

contract IntentHashHarnessForAccount {
    function hash(
        IIntentTypesV1.IntentV1 calldata intent,
        uint256 chainId,
        address verifyingContract
    ) external pure returns (bytes32) {
        return IntentHashV1.hashTypedData(intent, chainId, verifyingContract);
    }
}

contract Receiver {
    receive() external payable {}
}

contract MoneyOSAccountV1Test {
    uint256 internal constant OWNER_PK = 0xA11CE;
    uint256 internal constant AUTH_PK = 0xB0B;

    MoneyOSAccountV1 internal account;
    IntentHashHarnessForAccount internal hashHarness;
    Receiver internal receiver;

    address internal owner;
    address internal authorized;
    address internal sponsor;

    function setUp() public {
        owner = vm.addr(OWNER_PK);
        authorized = vm.addr(AUTH_PK);
        sponsor = address(0xBEEF);

        account = new MoneyOSAccountV1(owner);
        hashHarness = new IntentHashHarnessForAccount();
        receiver = new Receiver();

        (bool ok,) = address(account).call{value: 2 ether}("");
        require(ok, "funding failed");
    }

    function testOwnerSignatureExecutesAndIncrementsNonce() public {
        IIntentTypesV1.IntentV1 memory intent = _singleCallIntent(
            address(receiver),
            0.1 ether,
            "",
            0,
            sponsor
        );

        bytes memory signature = _signIntent(OWNER_PK, intent);
        uint256 beforeBalance = address(receiver).balance;

        vm.prank(sponsor);
        account.execute(intent, signature);

        require(address(receiver).balance == beforeBalance + 0.1 ether, "receiver did not get value");
        require(account.getNonce(owner, 0) == 1, "owner nonce lane not incremented");
    }

    function testAuthorizedKeyExecutesWithinScope() public {
        address[] memory targets = new address[](1);
        targets[0] = address(receiver);

        bytes4[] memory selectors = new bytes4[](1);
        selectors[0] = bytes4(0);

        vm.prank(owner);
        account.setAuthorizedKey(
            authorized,
            true,
            uint96(0.2 ether),
            uint48(block.timestamp),
            uint48(block.timestamp + 1 days),
            targets,
            selectors
        );

        IIntentTypesV1.IntentV1 memory intent = _singleCallIntent(
            address(receiver),
            0.05 ether,
            "",
            0,
            sponsor
        );

        bytes memory signature = _signIntent(AUTH_PK, intent);

        vm.prank(sponsor);
        account.execute(intent, signature);

        require(account.getNonce(authorized, 0) == 1, "authorized nonce lane not incremented");
    }

    function testAuthorizedKeyRejectedOutsideTargetScope() public {
        address[] memory targets = new address[](1);
        targets[0] = address(receiver);

        bytes4[] memory selectors = new bytes4[](1);
        selectors[0] = bytes4(0);

        vm.prank(owner);
        account.setAuthorizedKey(
            authorized,
            true,
            uint96(0.2 ether),
            uint48(block.timestamp),
            uint48(block.timestamp + 1 days),
            targets,
            selectors
        );

        IIntentTypesV1.IntentV1 memory intent = _singleCallIntent(
            address(0x1234),
            0.01 ether,
            "",
            0,
            sponsor
        );

        bytes memory signature = _signIntent(AUTH_PK, intent);

        vm.expectRevert(
            abi.encodeWithSelector(
                MoneyOSAccountV1.CallTargetNotAllowed.selector,
                authorized,
                address(0x1234)
            )
        );
        vm.prank(sponsor);
        account.execute(intent, signature);
    }

    function testErc1271OwnerOnlyEvenWhenAuthorizedKeyIsActive() public {
        address[] memory targets = new address[](1);
        targets[0] = address(receiver);

        bytes4[] memory selectors = new bytes4[](1);
        selectors[0] = bytes4(0);

        vm.prank(owner);
        account.setAuthorizedKey(
            authorized,
            true,
            uint96(0.2 ether),
            uint48(block.timestamp),
            uint48(block.timestamp + 1 days),
            targets,
            selectors
        );

        bytes32 digest = keccak256("erc1271-owner-only");
        bytes memory ownerSignature = _signDigest(OWNER_PK, digest);
        bytes memory authorizedSignature = _signDigest(AUTH_PK, digest);

        require(account.isValidSignature(digest, ownerSignature) == 0x1626ba7e, "owner must pass erc1271");
        require(account.isValidSignature(digest, authorizedSignature) == 0xffffffff, "authorized key must fail erc1271");
    }

    function testAuthorizedKeyValueCapIsEnforced() public {
        address[] memory targets = new address[](1);
        targets[0] = address(receiver);

        bytes4[] memory selectors = new bytes4[](1);
        selectors[0] = bytes4(0);

        vm.prank(owner);
        account.setAuthorizedKey(
            authorized,
            true,
            uint96(0.01 ether),
            uint48(block.timestamp),
            uint48(block.timestamp + 1 days),
            targets,
            selectors
        );

        IIntentTypesV1.IntentV1 memory intent = _singleCallIntent(
            address(receiver),
            0.02 ether,
            "",
            0,
            sponsor
        );

        bytes memory signature = _signIntent(AUTH_PK, intent);

        vm.expectRevert(
            abi.encodeWithSelector(
                MoneyOSAccountV1.CallValueExceedsScope.selector,
                authorized,
                0.02 ether,
                0.01 ether
            )
        );
        vm.prank(sponsor);
        account.execute(intent, signature);
    }

    function testAuthorizedKeyWindowIsEnforced() public {
        address[] memory targets = new address[](1);
        targets[0] = address(receiver);

        bytes4[] memory selectors = new bytes4[](1);
        selectors[0] = bytes4(0);

        uint48 keyValidAfter = uint48(block.timestamp + 100);
        uint48 keyValidUntil = uint48(block.timestamp + 200);

        vm.prank(owner);
        account.setAuthorizedKey(
            authorized,
            true,
            uint96(0.2 ether),
            keyValidAfter,
            keyValidUntil,
            targets,
            selectors
        );

        IIntentTypesV1.IntentV1 memory earlyIntent = _singleCallIntent(
            address(receiver),
            0.01 ether,
            "",
            0,
            sponsor
        );

        bytes memory earlySignature = _signIntent(AUTH_PK, earlyIntent);

        vm.expectRevert(MoneyOSAccountV1.Unauthorized.selector);
        vm.prank(sponsor);
        account.execute(earlyIntent, earlySignature);

        vm.warp(uint256(keyValidAfter) + 1);

        IIntentTypesV1.IntentV1 memory inWindowIntent = _singleCallIntent(
            address(receiver),
            0.01 ether,
            "",
            0,
            sponsor
        );

        bytes memory inWindowSignature = _signIntent(AUTH_PK, inWindowIntent);

        vm.prank(sponsor);
        account.execute(inWindowIntent, inWindowSignature);

        require(account.getNonce(authorized, 0) == 1, "authorized nonce lane should increment in-window");

        vm.warp(uint256(keyValidUntil) + 1);

        IIntentTypesV1.IntentV1 memory expiredIntent = _singleCallIntent(
            address(receiver),
            0.01 ether,
            "",
            1,
            sponsor
        );

        bytes memory expiredSignature = _signIntent(AUTH_PK, expiredIntent);

        vm.expectRevert(MoneyOSAccountV1.Unauthorized.selector);
        vm.prank(sponsor);
        account.execute(expiredIntent, expiredSignature);
    }

    function testExecuteForSponsorRejectsNonDeployerCaller() public {
        IIntentTypesV1.IntentV1 memory intent = _singleCallIntent(
            address(receiver),
            0.01 ether,
            "",
            0,
            sponsor
        );

        bytes memory signature = _signIntent(OWNER_PK, intent);

        vm.expectRevert(MoneyOSAccountV1.Unauthorized.selector);
        vm.prank(sponsor);
        account.executeForSponsor(intent, signature, sponsor);
    }

    function testReplayRejectedOnSameSignerNonceTuple() public {
        IIntentTypesV1.IntentV1 memory intent = _singleCallIntent(
            address(receiver),
            0.01 ether,
            "",
            0,
            sponsor
        );
        bytes memory signature = _signIntent(OWNER_PK, intent);

        vm.prank(sponsor);
        account.execute(intent, signature);

        vm.expectRevert(abi.encodeWithSelector(MoneyOSAccountV1.NonceMismatch.selector, uint64(1), uint64(0)));
        vm.prank(sponsor);
        account.execute(intent, signature);
    }

    function testSponsorMismatchRejectedBeforeExecution() public {
        IIntentTypesV1.IntentV1 memory intent = _singleCallIntent(
            address(receiver),
            0.01 ether,
            "",
            0,
            sponsor
        );
        bytes memory signature = _signIntent(OWNER_PK, intent);

        vm.expectRevert(MoneyOSAccountV1.SponsorMismatch.selector);
        account.execute(intent, signature);
    }

    function testExecuteRejectsEmptyCalls() public {
        IIntentTypesV1.Call[] memory calls = new IIntentTypesV1.Call[](0);
        IIntentTypesV1.IntentV1 memory intent = IIntentTypesV1.IntentV1({
            account: address(account),
            sponsor: sponsor,
            nonceKey: 0,
            nonceSeq: 0,
            validAfter: uint48(block.timestamp),
            validUntil: uint48(block.timestamp + 300),
            calls: calls
        });

        bytes memory signature = _signIntent(OWNER_PK, intent);

        vm.expectRevert(MoneyOSAccountV1.EmptyCalls.selector);
        vm.prank(sponsor);
        account.execute(intent, signature);
    }

    function _singleCallIntent(
        address target,
        uint256 value,
        bytes memory data,
        uint64 nonceSeq,
        address sponsorAddress
    ) internal view returns (IIntentTypesV1.IntentV1 memory intent) {
        IIntentTypesV1.Call[] memory calls = new IIntentTypesV1.Call[](1);
        calls[0] = IIntentTypesV1.Call({target: target, value: value, data: data});

        intent = IIntentTypesV1.IntentV1({
            account: address(account),
            sponsor: sponsorAddress,
            nonceKey: 0,
            nonceSeq: nonceSeq,
            validAfter: uint48(block.timestamp),
            validUntil: uint48(block.timestamp + 300),
            calls: calls
        });
    }

    function _signIntent(uint256 privateKey, IIntentTypesV1.IntentV1 memory intent)
        internal
        returns (bytes memory signature)
    {
        bytes32 digest = hashHarness.hash(intent, block.chainid, address(account));
        return _signDigest(privateKey, digest);
    }

    function _signDigest(uint256 privateKey, bytes32 digest)
        internal
        returns (bytes memory signature)
    {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        signature = abi.encodePacked(r, s, v);
    }
}
