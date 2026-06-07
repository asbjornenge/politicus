// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title EvmToMichelsonCounter — minimal cross-runtime forwarder
/// @notice Calls a Michelson counter contract via the Tezos X Native
///         Atomic Composability (NAC) gateway precompile at 0xff…07.
///
///         The Michelson side will see Tezos.get_sender() = this
///         forwarder's KT1 alias, NOT the EVM user's alias — that's the
///         core thing this PoC verifies.

interface INativeAtomicGateway {
    function callMichelson(
        string calldata destination,
        string calldata entrypoint,
        bytes calldata data
    ) external payable;
}

contract EvmToMichelsonCounter {
    /// @dev Per the Tezos X potluck-game reference, the precompile is
    ///      checksummed 0xfF…07. Lowercase 0xff…07 also works.
    address internal constant NAC_GATEWAY =
        0xfF00000000000000000000000000000000000007;

    /// @dev Micheline encoding of Unit ⇒ Prim D_Unit ⇒ `0x030b`.
    bytes internal constant UNIT = hex"030b";

    /// @dev Observed-worst-case for tiny entrypoints in the reference;
    ///      bump if your Michelson side does heavier work.
    uint256 internal constant GATEWAY_GAS = 3_000_000;

    string public michelsonCounter;
    uint256 public callCount;

    event Forwarded(string entrypoint, address evmCaller);

    constructor(string memory _michelsonCounter) {
        michelsonCounter = _michelsonCounter;
    }

    function increment() external { _callMichelson("increment"); }
    function decrement() external { _callMichelson("decrement"); }
    function reset()     external { _callMichelson("reset"); }

    function _callMichelson(string memory entrypoint) private {
        // Low-level .call is required: the precompile has no code, so
        // Solidity's high-level call would EXTCODESIZE-check and abort.
        bytes memory callData = abi.encodeWithSelector(
            INativeAtomicGateway.callMichelson.selector,
            michelsonCounter,
            entrypoint,
            UNIT
        );
        (bool ok, bytes memory ret) = NAC_GATEWAY.call{gas: GATEWAY_GAS}(callData);
        if (!ok) {
            assembly {
                let size := mload(ret)
                revert(add(ret, 32), size)
            }
        }
        callCount++;
        emit Forwarded(entrypoint, msg.sender);
    }
}
