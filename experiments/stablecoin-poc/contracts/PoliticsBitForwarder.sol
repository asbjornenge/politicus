// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface INativeAtomicGateway {
    function callMichelson(
        string calldata destination,
        string calldata entrypoint,
        bytes calldata data
    ) external payable;
}

/// @title PoliticsBitForwarder
/// @notice Pulls USDC from the user, then atomically calls
///         BitRegistryLogic.create_bit_via_forwarder via the NAC gateway.
///         Identity flows through the explicit payerKT1 parameter (caller
///         is expected to derive it off-chain via tez_getEthereumTezosAddress
///         — for the PoC we trust the caller; production would have a
///         smart-account wrapper or paymaster that owns the derivation).
contract PoliticsBitForwarder {
    address internal constant NAC_GATEWAY =
        0xfF00000000000000000000000000000000000007;
    uint256 internal constant GATEWAY_GAS = 3_000_000;

    IERC20 public immutable usdc;
    string public bitRegistry;       // KT1 of BitRegistryLogic
    address public owner;
    uint64  public bitsForwarded;

    event Forwarded(address indexed evmCaller, bytes payerKT1, bytes contentHash);

    constructor(address _usdc, string memory _bitRegistry) {
        usdc = IERC20(_usdc);
        bitRegistry = _bitRegistry;
        owner = msg.sender;
    }

    function setBitRegistry(string calldata r) external {
        require(msg.sender == owner, "NOT_OWNER");
        bitRegistry = r;
    }

    /// @notice Pay USDC and create a bit attributed to `payerKT1` (22-byte
    ///         optimised address form: 0x01 + KT1 hash + 0x00).
    /// @param  amount       USDC amount, 6 decimals.
    /// @param  contentHash  Raw IPFS CID bytes (utf8 of the b58 CID).
    /// @param  payerKT1     User's KT1 alias in 22-byte binary form.
    function payAndCreateBit(
        uint256 amount,
        bytes calldata contentHash,
        bytes calldata payerKT1
    ) external {
        require(amount > 0, "ZERO_AMOUNT");
        require(payerKT1.length == 22, "BAD_KT1_LENGTH");
        require(usdc.transferFrom(msg.sender, address(this), amount), "USDC_PULL_FAIL");

        // Build Micheline payload for BRL.create_bit_via_forwarder:
        //   address * bytes * bytes option * bytes option
        // = Pair payer (Pair content_hash (Pair parent_opt syndicate_opt))
        // For the PoC we hard-code parent=None and syndicate=None.
        bytes memory payload = _encodePair4(
            _encodeBytes(payerKT1),           // address (encoded as bytes literal — Michelson types it as address)
            _encodeBytes(contentHash),
            hex"0306",                         // None
            hex"0306"                          // None
        );

        bytes memory callData = abi.encodeWithSelector(
            INativeAtomicGateway.callMichelson.selector,
            bitRegistry, "create_bit_via_forwarder", payload
        );
        (bool ok, bytes memory ret) = NAC_GATEWAY.call{gas: GATEWAY_GAS}(callData);
        if (!ok) { assembly { revert(add(ret, 32), mload(ret)) } }
        bitsForwarded++;
        emit Forwarded(msg.sender, payerKT1, contentHash);
    }

    // ---- Micheline helpers ----

    /// @dev Right-associated 4-tuple: Pair(a, Pair(b, Pair(c, d)))
    function _encodePair4(bytes memory a, bytes memory b, bytes memory c, bytes memory d)
        private pure returns (bytes memory)
    {
        return abi.encodePacked(hex"0707", a, hex"0707", b, hex"0707", c, d);
    }

    function _encodeBytes(bytes memory data) private pure returns (bytes memory) {
        uint32 len = uint32(data.length);
        return abi.encodePacked(
            hex"0a",
            bytes1(uint8(len >> 24)),
            bytes1(uint8(len >> 16)),
            bytes1(uint8(len >> 8)),
            bytes1(uint8(len)),
            data
        );
    }
}
