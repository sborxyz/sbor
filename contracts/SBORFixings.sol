// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title SBOR fixings on Arc
/// @notice SBOR's daily benchmark lending rates, published on-chain so any Arc
///         application, vault or agent can read them. Rates are in basis
///         points (2.69% is 269), each with the date of the fixing it comes
///         from (YYYYMMDD, UTC). The full methodology is at https://sbor.xyz.
/// @dev    The owner controls the contract; the publisher can only post rates.
///         The publisher is SBOR's daily automation. If its key is ever
///         exposed, the owner replaces it, and nothing else is at risk.
///         A day may be republished, as SBOR's corrections policy allows;
///         an older date can never overwrite a newer one.
contract SBORFixings {
    struct Rate {
        uint32 date;        // YYYYMMDD of the SBOR fixing
        uint16 borrowBps;   // borrow rate, basis points, effective APY
        uint16 supplyBps;   // supply rate, basis points, effective APY
        uint64 depthUsd;    // total supplied, whole US dollars
        uint64 publishedAt; // block timestamp of the publication
    }

    address public owner;
    address public publisher;

    /// @notice The latest rate for a key, such as bytes32("SBOR-USD").
    mapping(bytes32 => Rate) public latest;

    /// @notice The rate for a key on a given fixing date.
    mapping(bytes32 => mapping(uint32 => Rate)) public onDate;

    event Published(bytes32 indexed key, uint32 indexed date, uint16 borrowBps, uint16 supplyBps, uint64 depthUsd);
    event PublisherChanged(address indexed previous, address indexed next);
    event OwnershipTransferred(address indexed previous, address indexed next);

    error NotOwner();
    error NotPublisher();
    error LengthMismatch();
    error OlderThanLatest(bytes32 key, uint32 date, uint32 latestDate);
    error BadDate(uint32 date);
    error ZeroAddress();

    constructor(address initialPublisher) {
        if (initialPublisher == address(0)) revert ZeroAddress();
        owner = msg.sender;
        publisher = initialPublisher;
        emit OwnershipTransferred(address(0), msg.sender);
        emit PublisherChanged(address(0), initialPublisher);
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    /// @notice Post one fixing date's rates for one or more keys.
    function publish(
        uint32 date,
        bytes32[] calldata keys,
        uint16[] calldata borrowBps,
        uint16[] calldata supplyBps,
        uint64[] calldata depthUsd
    ) external {
        if (msg.sender != publisher) revert NotPublisher();
        uint256 n = keys.length;
        if (borrowBps.length != n || supplyBps.length != n || depthUsd.length != n) revert LengthMismatch();
        if (date < 20260101 || date > 21001231) revert BadDate(date);
        for (uint256 i = 0; i < n; i++) {
            _write(keys[i], date, borrowBps[i], supplyBps[i], depthUsd[i]);
        }
    }

    function _write(bytes32 key, uint32 date, uint16 borrow, uint16 supply, uint64 depth) private {
        uint32 latestDate = latest[key].date;
        if (date < latestDate) revert OlderThanLatest(key, date, latestDate);
        Rate memory r = Rate(date, borrow, supply, depth, uint64(block.timestamp));
        latest[key] = r;
        onDate[key][date] = r;
        emit Published(key, date, borrow, supply, depth);
    }

    /// @notice Replace the publisher, for example if its key is exposed.
    function setPublisher(address next) external onlyOwner {
        if (next == address(0)) revert ZeroAddress();
        emit PublisherChanged(publisher, next);
        publisher = next;
    }

    function transferOwnership(address next) external onlyOwner {
        if (next == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, next);
        owner = next;
    }
}
