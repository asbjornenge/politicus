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

/// @title PoliticsPayments — cross-runtime escrow forwarder
/// @notice User approves USDC to this contract; user calls payAndPost();
///         contract pulls USDC and atomically calls the Michelson receiver
///         via the NAC gateway. If the Michelson call reverts, the USDC
///         transfer is rolled back too.
contract PoliticsPayments {
    address internal constant NAC_GATEWAY =
        0xfF00000000000000000000000000000000000007;
    uint256 internal constant GATEWAY_GAS = 3_000_000;

    IERC20 public immutable usdc;
    string public michelsonReceiver;          // KT1 of PaymentReceiver
    address public owner;
    uint64  public nonce;                     // monotonic per-call counter

    event Paid(address indexed payer, uint256 amount, bytes content, uint64 nonce);

    constructor(address _usdc, string memory _receiver) {
        usdc = IERC20(_usdc);
        michelsonReceiver = _receiver;
        owner = msg.sender;
    }

    function setReceiver(string calldata r) external {
        require(msg.sender == owner, "NOT_OWNER");
        michelsonReceiver = r;
    }

    /// @notice Pay USDC, record the bit content on the Michelson side.
    /// @dev    Atomic: if the cross-runtime call reverts (e.g. receiver
    ///         rejects), the whole tx — including transferFrom — is rolled
    ///         back. That's the core Tezos X composability guarantee.
    function payAndPost(uint256 amount, bytes calldata content) external {
        require(amount > 0, "ZERO_AMOUNT");
        require(usdc.transferFrom(msg.sender, address(this), amount), "USDC_PULL_FAIL");
        nonce++;

        // Build Micheline payload: Pair(payer_bytes, Pair(amount_nat, content_bytes)).
        bytes memory payload = _encodePair(
            _encodeBytes(abi.encodePacked(msg.sender)),
            _encodePair(_encodeNat(amount), _encodeBytes(content))
        );

        bytes memory callData = abi.encodeWithSelector(
            INativeAtomicGateway.callMichelson.selector,
            michelsonReceiver, "record_payment", payload
        );
        (bool ok, bytes memory ret) = NAC_GATEWAY.call{gas: GATEWAY_GAS}(callData);
        if (!ok) {
            assembly { revert(add(ret, 32), mload(ret)) }
        }
        emit Paid(msg.sender, amount, content, nonce);
    }

    // ---- Micheline encoders (minimal subset) ----

    /// Pair primitive ⇒ prefix 0x0707 + left + right
    function _encodePair(bytes memory a, bytes memory b) private pure returns (bytes memory) {
        return abi.encodePacked(hex"0707", a, b);
    }

    /// bytes literal ⇒ 0x0a + 4-byte big-endian length + bytes
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

    /// int/nat literal ⇒ 0x00 (Micheline int tag) + signed-zarith bytes.
    /// First byte:  [cont(1) | sign(1) | data(6)], LSB-first
    /// Subsequent:  [cont(1) | data(7)]
    /// For nat values, the sign bit is always 0. NB: 7-bits-everywhere
    /// is WRONG — first byte only carries 6 magnitude bits.
    function _encodeNat(uint256 n) private pure returns (bytes memory) {
        if (n == 0) return hex"0000";
        bytes memory tmp = new bytes(40);
        uint256 i;

        // First byte: 6 magnitude bits, sign bit = 0
        uint8 first = uint8(n & 0x3f);
        n >>= 6;
        if (n > 0) first |= 0x80;
        tmp[i++] = bytes1(first);

        // Subsequent bytes: 7 magnitude bits
        while (n > 0) {
            uint8 b = uint8(n & 0x7f);
            n >>= 7;
            if (n > 0) b |= 0x80;
            tmp[i++] = bytes1(b);
        }

        bytes memory out = new bytes(i + 1);
        out[0] = 0x00;
        for (uint256 j; j < i; j++) out[1 + j] = tmp[j];
        return out;
    }
}
