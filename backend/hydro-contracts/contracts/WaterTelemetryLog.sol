// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IWaterQuotaRegistry {
    function reporterSector(address) external view returns (bytes32);
    function owner() external view returns (address);
}

/// @title WaterTelemetryLog
/// @notice One latest snapshot per sector. Not connected to valve logic. History lives in events.
contract WaterTelemetryLog {
    event SnapshotRecorded(
        bytes32 indexed sectorId,
        uint256 upstreamFlowRate,
        uint256 downstreamFlowRate,
        uint256 deltaQ,
        uint256 dailyVolumeUsed,
        uint256 timestamp
    );

    struct Snapshot {
        uint256 upstreamFlowRate;
        uint256 downstreamFlowRate;
        uint256 deltaQ;
        uint256 dailyVolumeUsed;
        uint256 timestamp;
    }

    IWaterQuotaRegistry public immutable registry;
    uint256 public minIntervalSeconds;

    mapping(bytes32 => Snapshot) public latestSnapshot;
    mapping(bytes32 => uint256) public snapshotCount;

    error ZeroRegistry();
    error NotSectorReporter();
    error TooSoon();
    error FlowOutOfRange();
    error NotRegistryOwner();

    /// @param minIntervalSeconds_ Deploy default is 210, just under the aggregator's 4 minute snapshot period.
    constructor(address registry_, uint256 minIntervalSeconds_) {
        if (registry_ == address(0)) revert ZeroRegistry();
        registry = IWaterQuotaRegistry(registry_);
        minIntervalSeconds = minIntervalSeconds_;
    }

    /// @notice Store the latest snapshot. Flow values are scaled x100 and capped at 500 L/min.
    function recordSnapshot(
        bytes32 sectorId,
        uint256 upstreamFlowRate,
        uint256 downstreamFlowRate,
        uint256 deltaQ,
        uint256 dailyVolumeUsed
    ) external {
        bytes32 bound = registry.reporterSector(msg.sender);
        // bytes32(0) is not a sector. An unbound caller must not match a zero id.
        if (bound == bytes32(0) || bound != sectorId) revert NotSectorReporter();
        if (block.timestamp < latestSnapshot[sectorId].timestamp + minIntervalSeconds) revert TooSoon();
        if (upstreamFlowRate > 50000 || downstreamFlowRate > 50000 || deltaQ > 50000) {
            revert FlowOutOfRange();
        }

        latestSnapshot[sectorId] = Snapshot({
            upstreamFlowRate: upstreamFlowRate,
            downstreamFlowRate: downstreamFlowRate,
            deltaQ: deltaQ,
            dailyVolumeUsed: dailyVolumeUsed,
            timestamp: block.timestamp
        });
        snapshotCount[sectorId] += 1;
        emit SnapshotRecorded(
            sectorId,
            upstreamFlowRate,
            downstreamFlowRate,
            deltaQ,
            dailyVolumeUsed,
            block.timestamp
        );
    }

    function setMinInterval(uint256 v) external {
        if (msg.sender != registry.owner()) revert NotRegistryOwner();
        minIntervalSeconds = v;
    }
}
