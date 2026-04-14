// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MoneyOSAccountV1} from "./MoneyOSAccountV1.sol";
import {IIntentTypesV1} from "./interfaces/IIntentTypesV1.sol";

contract MoneyOSAccountFactoryV1 {
    error InvalidOwner();
    error FundingFailed();

    event AccountDeployed(address indexed owner, address indexed account, bytes32 indexed salt);

    function computeAccountAddress(address owner, bytes32 salt) public view returns (address) {
        if (owner == address(0)) {
            revert InvalidOwner();
        }

        bytes memory bytecode = abi.encodePacked(type(MoneyOSAccountV1).creationCode, abi.encode(owner));
        bytes32 initCodeHash = keccak256(bytecode);
        bytes32 digest = keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, initCodeHash));

        return address(uint160(uint256(digest)));
    }

    function deployAccount(address owner, bytes32 salt) public returns (address account) {
        account = _deployOrGet(owner, salt, 0);
    }

    function deployAndExecute(
        address owner,
        bytes32 salt,
        IIntentTypesV1.IntentV1 calldata intent,
        bytes calldata signature
    ) external payable returns (address account, bytes[] memory results) {
        account = _deployOrGet(owner, salt, msg.value);
        results = MoneyOSAccountV1(payable(account)).executeForSponsor(intent, signature, msg.sender);
    }

    function _deployOrGet(address owner, bytes32 salt, uint256 funding)
        internal
        returns (address account)
    {
        account = computeAccountAddress(owner, salt);

        if (account.code.length != 0) {
            if (funding != 0) {
                (bool ok,) = payable(account).call{value: funding}("");
                if (!ok) {
                    revert FundingFailed();
                }
            }
            return account;
        }

        account = address(new MoneyOSAccountV1{salt: salt, value: funding}(owner));
        emit AccountDeployed(owner, account, salt);
    }
}
