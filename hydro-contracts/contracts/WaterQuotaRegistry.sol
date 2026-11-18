// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title WaterQuotaRegistry
/// @notice Audit record for sector flow, quotas, and valve-closure decisions.
///         This contract never actuates hardware. The aggregator closes the valve.
contract WaterQuotaRegistry {
    /// @dev Field order is fixed so the aggregator ABI stays compatible.
    struct SectorState {
        uint256 upstreamFlowRate; // scaled x100
        uint256 downstreamFlowRate; // sum of outlets, scaled x100
        uint256 deltaQ; // scaled x100
        uint256 dailyVolumeUsed; // litres x100
        uint256 dailyQuotaLimit; // litres x100
        bool isValveClosed;
        uint256 lastUpdated; // block.timestamp
    }

    mapping(bytes32 => SectorState) public sectorRegistry;

    address public owner;
    uint256 public leakThreshold = 500;
    uint256 public dayOffsetSeconds;

    mapping(bytes32 => bool) public sectorExists;
    mapping(address => bytes32) public reporterSector;
    /// @dev 0 none, 1 leak, 2 quota.
    mapping(bytes32 => uint8) public closeCause;
    mapping(bytes32 => uint256) public quotaDay;

    event SectorAlert(bytes32 indexed sectorId, string reason, uint256 timestamp);
    event SectorAdded(bytes32 indexed sectorId, uint256 quotaLimit);
    event SectorReset(bytes32 indexed sectorId, address indexed by, uint256 timestamp);
    event DailyRollover(bytes32 indexed sectorId, uint256 dayIndex, bool valveReopened, uint256 timestamp);
    event QuotaChanged(bytes32 indexed sectorId, uint256 oldQuota, uint256 newQuota, uint256 timestamp);
    event LeakThresholdChanged(uint256 oldValue, uint256 newValue);
    event DayOffsetChanged(uint256 oldValue, uint256 newValue);
    event ReporterAdded(address indexed reporter, bytes32 indexed sectorId);
    event ReporterRemoved(address indexed reporter, bytes32 indexed sectorId);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    error NotOwner();
    error ZeroAddress();
    error ZeroSectorId();
    error SectorAlreadyExists();
    error SectorUnknown();
    error QuotaMustBePositive();
    error ThresholdMustBePositive();
    error DayOffsetTooLarge();
    error AlreadyReporter();
    error NotAReporter();
    error ReporterSectorMismatch();
    error RolloverNotDue();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    /// @notice Create a sector with the valve open.
    function addSector(bytes32 id, uint256 quota) external onlyOwner {
        if (id == bytes32(0)) revert ZeroSectorId();
        if (sectorExists[id]) revert SectorAlreadyExists();
        if (quota == 0) revert QuotaMustBePositive();

        sectorExists[id] = true;
        SectorState storage sector = sectorRegistry[id];
        sector.dailyQuotaLimit = quota;
        sector.isValveClosed = false;
        sector.lastUpdated = block.timestamp;
        quotaDay[id] = currentDay();
        emit SectorAdded(id, quota);
    }

    function setSectorQuota(bytes32 id, uint256 newQuota) external onlyOwner {
        if (!sectorExists[id]) revert SectorUnknown();
        if (newQuota == 0) revert QuotaMustBePositive();

        uint256 oldQuota = sectorRegistry[id].dailyQuotaLimit;
        sectorRegistry[id].dailyQuotaLimit = newQuota;
        emit QuotaChanged(id, oldQuota, newQuota, block.timestamp);
    }

    function setLeakThreshold(uint256 v) external onlyOwner {
        if (v == 0) revert ThresholdMustBePositive();
        uint256 oldValue = leakThreshold;
        leakThreshold = v;
        emit LeakThresholdChanged(oldValue, v);
    }

    /// @param v Seconds added before the UTC day index. Must be below 86400.
    function setDayOffsetSeconds(uint256 v) external onlyOwner {
        if (v >= 86400) revert DayOffsetTooLarge();
        uint256 oldValue = dayOffsetSeconds;
        dayOffsetSeconds = v;
        emit DayOffsetChanged(oldValue, v);
    }

    /// @notice Bind a reporter to one existing sector. Several reporters per sector are allowed.
    function addReporter(address r, bytes32 id) external onlyOwner {
        if (!sectorExists[id]) revert SectorUnknown();
        if (r == address(0)) revert ZeroAddress();
        if (reporterSector[r] != bytes32(0)) revert AlreadyReporter();

        reporterSector[r] = id;
        emit ReporterAdded(r, id);
    }

    function removeReporter(address r) external onlyOwner {
        bytes32 id = reporterSector[r];
        if (id == bytes32(0)) revert NotAReporter();
        reporterSector[r] = bytes32(0);
        emit ReporterRemoved(r, id);
    }

    function transferOwnership(address n) external onlyOwner {
        if (n == address(0)) revert ZeroAddress();
        address previousOwner = owner;
        owner = n;
        emit OwnershipTransferred(previousOwner, n);
    }

    /// @notice Reporter update for one sector.
    /// @dev `deltaQ` and `dailyQuotaLimit` are ignored. They stay in the signature so the
    ///      aggregator ABI does not change. Stored deltaQ is recomputed. Stored quota is the
    ///      owner's value. `dailyVolumeUsed` is trusted from the reporter and is not recomputed.
    ///      This function never actuates a valve or any other hardware.
    function updateSectorState(
        bytes32 id,
        uint256 upstreamFlowRate,
        uint256 downstreamFlowRate,
        uint256, /* deltaQ ignored */
        uint256 dailyVolumeUsed,
        uint256 /* dailyQuotaLimit ignored */
    ) external {
        if (!sectorExists[id]) revert SectorUnknown();
        if (reporterSector[msg.sender] != id) revert ReporterSectorMismatch();

        uint256 computed = upstreamFlowRate > downstreamFlowRate
            ? upstreamFlowRate - downstreamFlowRate
            : 0;

        SectorState storage sector = sectorRegistry[id];
        sector.upstreamFlowRate = upstreamFlowRate;
        sector.downstreamFlowRate = downstreamFlowRate;
        sector.deltaQ = computed;
        sector.dailyVolumeUsed = dailyVolumeUsed;
        sector.lastUpdated = block.timestamp;

        // Already closed: keep the original cause and do not alert again.
        if (sector.isValveClosed) return;

        if (computed > leakThreshold) {
            sector.isValveClosed = true;
            closeCause[id] = 1;
            emit SectorAlert(id, "ANOMALY_DETECTED", block.timestamp);
        } else if (dailyVolumeUsed > sector.dailyQuotaLimit) {
            sector.isValveClosed = true;
            closeCause[id] = 2;
            emit SectorAlert(id, "QUOTA_EXCEEDED", block.timestamp);
        }
    }

    /// @notice Advance the quota day. A quota closure reopens. A leak closure stays closed.
    function rolloverQuotaDay(bytes32 id) external {
        if (!sectorExists[id]) revert SectorUnknown();
        if (msg.sender != owner && reporterSector[msg.sender] != id) revert ReporterSectorMismatch();

        uint256 dayNow = currentDay();
        if (dayNow <= quotaDay[id]) revert RolloverNotDue();

        quotaDay[id] = dayNow;
        sectorRegistry[id].dailyVolumeUsed = 0;

        bool valveReopened = false;
        if (sectorRegistry[id].isValveClosed && closeCause[id] == 2) {
            sectorRegistry[id].isValveClosed = false;
            closeCause[id] = 0;
            valveReopened = true;
        }

        emit DailyRollover(id, dayNow, valveReopened, block.timestamp);
    }

    /// @notice Owner reopen. Clears volume and close cause. Does not talk to MQTT.
    function resetSector(bytes32 id) external onlyOwner {
        if (!sectorExists[id]) revert SectorUnknown();

        SectorState storage sector = sectorRegistry[id];
        sector.isValveClosed = false;
        sector.dailyVolumeUsed = 0;
        closeCause[id] = 0;
        sector.lastUpdated = block.timestamp;
        emit SectorReset(id, msg.sender, block.timestamp);
    }

    function currentDay() public view returns (uint256) {
        return (block.timestamp + dayOffsetSeconds) / 1 days;
    }

    function isReporter(address a) external view returns (bool) {
        return reporterSector[a] != bytes32(0);
    }
}
