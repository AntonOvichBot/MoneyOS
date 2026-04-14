// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ECDSA} from "./lib/ECDSA.sol";
import {IntentHashV1} from "./lib/IntentHashV1.sol";
import {IIntentTypesV1} from "./interfaces/IIntentTypesV1.sol";

contract MoneyOSAccountV1 {
    bytes4 internal constant ERC1271_MAGICVALUE = 0x1626ba7e;
    bytes4 internal constant ERC1271_INVALID = 0xffffffff;

    error Unauthorized();
    error InvalidOwner();
    error InvalidIntentAccount();
    error InvalidIntentWindow();
    error SponsorMismatch();
    error InvalidSignature();
    error InvalidAuthorizedKey();
    error NonceMismatch(uint64 expected, uint64 received);
    error CallTargetNotAllowed(address signer, address target);
    error CallSelectorNotAllowed(address signer, bytes4 selector);
    error CallValueExceedsScope(address signer, uint256 value, uint256 maxValue);
    error EmptyCalls();

    event OwnerUpdated(address indexed previousOwner, address indexed newOwner);
    event AuthorizedKeyConfigured(
        address indexed key,
        bool enabled,
        uint96 maxValueWei,
        uint48 validAfter,
        uint48 validUntil,
        uint64 epoch
    );
    event AuthorizedKeyRevoked(address indexed key, uint64 epoch);
    event IntentExecuted(
        address indexed signer,
        address indexed sponsor,
        uint192 indexed nonceKey,
        uint64 nonceSeq,
        bytes32 intentDigest
    );

    struct KeyScope {
        bool enabled;
        uint96 maxValueWei;
        uint48 validAfter;
        uint48 validUntil;
        uint64 epoch;
    }

    address public owner;
    address public immutable deployer;

    mapping(address signer => mapping(uint192 nonceKey => uint64 nextNonce)) private _laneNonces;
    mapping(address key => KeyScope scope) private _keyScopes;
    mapping(address key => mapping(uint64 epoch => mapping(address target => bool allowed)))
        private _allowedTargets;
    mapping(address key => mapping(uint64 epoch => mapping(bytes4 selector => bool allowed)))
        private _allowedSelectors;

    modifier onlyOwner() {
        if (msg.sender != owner) {
            revert Unauthorized();
        }
        _;
    }

    constructor(address initialOwner) payable {
        if (initialOwner == address(0)) {
            revert InvalidOwner();
        }

        deployer = msg.sender;
        owner = initialOwner;
        emit OwnerUpdated(address(0), initialOwner);
    }

    receive() external payable {}

    function setOwner(address newOwner) external onlyOwner {
        if (newOwner == address(0)) {
            revert InvalidOwner();
        }

        address oldOwner = owner;
        owner = newOwner;
        emit OwnerUpdated(oldOwner, newOwner);
    }

    function setAuthorizedKey(
        address key,
        bool enabled,
        uint96 maxValueWei,
        uint48 validAfter,
        uint48 validUntil,
        address[] calldata allowedTargets,
        bytes4[] calldata allowedSelectors
    ) external onlyOwner {
        if (key == address(0)) {
            revert InvalidAuthorizedKey();
        }

        if (validUntil != 0 && validUntil < validAfter) {
            revert InvalidIntentWindow();
        }

        if (enabled) {
            if (allowedTargets.length == 0 || allowedSelectors.length == 0) {
                revert Unauthorized();
            }
        } else if (allowedTargets.length != 0 || allowedSelectors.length != 0) {
            revert Unauthorized();
        }

        uint64 nextEpoch = _keyScopes[key].epoch + 1;
        _keyScopes[key] = KeyScope({
            enabled: enabled,
            maxValueWei: maxValueWei,
            validAfter: validAfter,
            validUntil: validUntil,
            epoch: nextEpoch
        });

        if (enabled) {
            for (uint256 i = 0; i < allowedTargets.length; i++) {
                _allowedTargets[key][nextEpoch][allowedTargets[i]] = true;
            }

            for (uint256 i = 0; i < allowedSelectors.length; i++) {
                _allowedSelectors[key][nextEpoch][allowedSelectors[i]] = true;
            }
        }

        emit AuthorizedKeyConfigured(
            key,
            enabled,
            maxValueWei,
            validAfter,
            validUntil,
            nextEpoch
        );
    }

    function revokeAuthorizedKey(address key) external onlyOwner {
        uint64 nextEpoch = _keyScopes[key].epoch + 1;

        _keyScopes[key] = KeyScope({
            enabled: false,
            maxValueWei: 0,
            validAfter: 0,
            validUntil: 0,
            epoch: nextEpoch
        });

        emit AuthorizedKeyRevoked(key, nextEpoch);
    }

    function getNonce(address signer, uint192 nonceKey) external view returns (uint64) {
        return _laneNonces[signer][nonceKey];
    }

    function getKeyScope(address key)
        external
        view
        returns (bool enabled, uint96 maxValueWei, uint48 validAfter, uint48 validUntil, uint64 epoch)
    {
        KeyScope memory scope = _keyScopes[key];
        return (
            scope.enabled,
            scope.maxValueWei,
            scope.validAfter,
            scope.validUntil,
            scope.epoch
        );
    }

    function isTargetAllowed(address key, address target) external view returns (bool) {
        KeyScope memory scope = _keyScopes[key];
        return _allowedTargets[key][scope.epoch][target];
    }

    function isSelectorAllowed(address key, bytes4 selector) external view returns (bool) {
        KeyScope memory scope = _keyScopes[key];
        return _allowedSelectors[key][scope.epoch][selector];
    }

    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4) {
        address signer = ECDSA.recover(hash, signature);
        if (signer == owner) {
            return ERC1271_MAGICVALUE;
        }

        return ERC1271_INVALID;
    }

    function execute(IIntentTypesV1.IntentV1 calldata intent, bytes calldata signature)
        external
        payable
        returns (bytes[] memory results)
    {
        return _execute(intent, signature, msg.sender);
    }

    function executeForSponsor(
        IIntentTypesV1.IntentV1 calldata intent,
        bytes calldata signature,
        address sponsorCaller
    ) external payable returns (bytes[] memory results) {
        if (msg.sender != deployer) {
            revert Unauthorized();
        }

        return _execute(intent, signature, sponsorCaller);
    }

    function _execute(
        IIntentTypesV1.IntentV1 calldata intent,
        bytes calldata signature,
        address sponsorCaller
    ) internal returns (bytes[] memory results) {
        if (intent.account != address(this)) {
            revert InvalidIntentAccount();
        }

        if (intent.calls.length == 0) {
            revert EmptyCalls();
        }

        _validateIntentWindow(intent.validAfter, intent.validUntil);

        if (intent.sponsor != address(0) && sponsorCaller != intent.sponsor) {
            revert SponsorMismatch();
        }

        bytes32 digest = IntentHashV1.hashTypedData(intent, block.chainid, address(this));
        address signer = ECDSA.recover(digest, signature);
        if (signer == address(0)) {
            revert InvalidSignature();
        }

        if (signer != owner) {
            _enforceAuthorizedKeyScope(signer, intent.calls);
        }

        uint64 expectedNonce = _laneNonces[signer][intent.nonceKey];
        if (expectedNonce != intent.nonceSeq) {
            revert NonceMismatch(expectedNonce, intent.nonceSeq);
        }
        _laneNonces[signer][intent.nonceKey] = expectedNonce + 1;

        results = new bytes[](intent.calls.length);
        for (uint256 i = 0; i < intent.calls.length; i++) {
            IIntentTypesV1.Call calldata call_ = intent.calls[i];
            (bool ok, bytes memory ret) = call_.target.call{value: call_.value}(call_.data);
            if (!ok) {
                _bubbleRevert(ret);
            }
            results[i] = ret;
        }

        emit IntentExecuted(signer, intent.sponsor, intent.nonceKey, intent.nonceSeq, digest);
    }

    function _validateIntentWindow(uint48 validAfter, uint48 validUntil) internal view {
        if (validUntil != 0 && validUntil < validAfter) {
            revert InvalidIntentWindow();
        }

        uint256 ts = block.timestamp;
        if (ts < validAfter) {
            revert InvalidIntentWindow();
        }

        if (validUntil != 0 && ts > validUntil) {
            revert InvalidIntentWindow();
        }
    }

    function _enforceAuthorizedKeyScope(address signer, IIntentTypesV1.Call[] calldata calls) internal view {
        KeyScope memory scope = _keyScopes[signer];
        if (!scope.enabled) {
            revert Unauthorized();
        }

        uint256 ts = block.timestamp;
        if (ts < scope.validAfter) {
            revert Unauthorized();
        }
        if (scope.validUntil != 0 && ts > scope.validUntil) {
            revert Unauthorized();
        }

        for (uint256 i = 0; i < calls.length; i++) {
            IIntentTypesV1.Call calldata call_ = calls[i];

            if (!_allowedTargets[signer][scope.epoch][call_.target]) {
                revert CallTargetNotAllowed(signer, call_.target);
            }

            bytes4 selector = _selectorFromCallData(call_.data);
            if (!_allowedSelectors[signer][scope.epoch][selector]) {
                revert CallSelectorNotAllowed(signer, selector);
            }

            if (call_.value > scope.maxValueWei) {
                revert CallValueExceedsScope(signer, call_.value, scope.maxValueWei);
            }
        }
    }

    function _isSignerActive(address signer) internal view returns (bool) {
        if (signer == owner) {
            return true;
        }

        KeyScope memory scope = _keyScopes[signer];
        if (!scope.enabled) {
            return false;
        }

        uint256 ts = block.timestamp;
        if (ts < scope.validAfter) {
            return false;
        }
        if (scope.validUntil != 0 && ts > scope.validUntil) {
            return false;
        }

        return true;
    }

    function _selectorFromCallData(bytes calldata data) internal pure returns (bytes4 selector) {
        if (data.length < 4) {
            return bytes4(0);
        }

        assembly {
            selector := calldataload(data.offset)
        }
    }

    function _bubbleRevert(bytes memory data) private pure {
        if (data.length == 0) {
            revert Unauthorized();
        }

        assembly {
            revert(add(data, 32), mload(data))
        }
    }
}
