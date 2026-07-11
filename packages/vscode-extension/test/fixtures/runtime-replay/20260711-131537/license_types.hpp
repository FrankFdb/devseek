#ifndef HD_UAV_LICENSE_TYPES_HPP
#define HD_UAV_LICENSE_TYPES_HPP

#include <cstdint>
#include <string>

namespace hd_license {

constexpr const char* kTopicLicenseState = "/uav/license/state";
constexpr const char* kTopicLicenseTunnelRx = "/uav/license/tunnel/rx";
constexpr const char* kTopicLicenseTunnelTx = "/uav/license/tunnel/tx";

constexpr uint16_t kMavTunnelCmdLicense = 33007;
// Must match uav_lock_reason1_en::LOCK_REASON_MCM_LICENSE_LOCKED in config.h.
constexpr uint32_t kLicenseArmLockMask = (1U << 24);

constexpr uint8_t kTunnelVersion = 1;
constexpr uint32_t kTunnelMaxTotalLen = 64 * 1024;
constexpr uint32_t kTunnelSessionTimeoutMs = 5000;

enum class TunnelMsgType : uint8_t {
    PushChunk = 1,
    AckChunk = 2,
    StatusQueryChunk = 3,
    StatusChunk = 4,
    Cancel = 5
};

enum TunnelFlags : uint16_t {
    kTunnelFlagEnd = 1 << 0,
    kTunnelFlagNeedAck = 1 << 1
};

#pragma pack(push, 1)
struct LicenseTunnelHeader {
    uint8_t version;
    uint8_t msgType;
    uint16_t flags;
    uint32_t sessionId;
    uint16_t seq;
    uint16_t total;
    uint16_t payloadLen;
    uint32_t totalLen;
    uint32_t crc32;
};
#pragma pack(pop)

enum class LicenseBlockReason : uint8_t {
    Disabled = 0,
    Valid,
    NoLicense,
    SignatureInvalid,
    KeyUnknown,
    PublicKeyUnconfigured,
    DeviceMismatch,
    StatusInactive,
    Expired,
    SyncOverdue,
    TimeUntrusted,
    PayloadInvalid,
    StorageError,
    TransportError,
    PayloadTimeMismatch
};

struct LicenseStatusSnapshot {
    bool enabled = true;
    bool publicKeyConfigured = false;
    uint32_t configuredPublicKeyCount = 0;
    bool valid = false;
    bool shouldLock = false;
    LicenseBlockReason reason = LicenseBlockReason::NoLicense;
    uint32_t lockMask = 0;
    std::string licenseId;
    std::string droneId;
    std::string mcmId;
    std::string keyId;
    uint64_t expireAtMs = 0;
    uint64_t syncDeadlineAtMs = 0;
    uint64_t lastSyncAtMs = 0;
    uint64_t lastCheckedAtMs = 0;
};

struct LicenseTimeContext {
    uint64_t nowMs = 0;
    uint64_t systemNowMs = 0;
    bool trusted = false;
};

struct LicenseEnvelope {
    std::string requestId;
    std::string licenseIdHint;
    std::string remoterId;
    std::string payloadRaw;
    std::string signatureBase64;
    std::string alg;
    std::string keyId;
    uint64_t receiveTimeMs = 0;
};

struct LicensePayload {
    std::string licenseId;
    std::string droneId;
    std::string mcmId;
    std::string status; // Platform payload status: active or revoked. Empty only for older stored licenses.
    uint64_t issuedAtMs = 0;
    uint64_t expireAtMs = 0;
    uint64_t syncDeadlineAtMs = 0;
    uint32_t maxSyncIntervalDays = 30;
};

struct StoredLicense {
    LicenseEnvelope envelope;
    LicensePayload payload;
    uint64_t lastSyncAtMs = 0;
    uint64_t savedAtMs = 0;
};

inline const char* reason_to_string(LicenseBlockReason reason)
{
    switch (reason)
    {
    case LicenseBlockReason::Disabled: return "disabled";
    case LicenseBlockReason::Valid: return "valid";
    case LicenseBlockReason::NoLicense: return "no_license";
    case LicenseBlockReason::SignatureInvalid: return "signature_invalid";
    case LicenseBlockReason::KeyUnknown: return "key_unknown";
    case LicenseBlockReason::PublicKeyUnconfigured: return "public_key_unconfigured";
    case LicenseBlockReason::DeviceMismatch: return "device_mismatch";
    case LicenseBlockReason::StatusInactive: return "status_revoked";
    case LicenseBlockReason::Expired: return "expired";
    case LicenseBlockReason::SyncOverdue: return "sync_overdue";
    case LicenseBlockReason::TimeUntrusted: return "time_untrusted";
    case LicenseBlockReason::PayloadTimeMismatch: return "payload_time_mismatch";
    case LicenseBlockReason::PayloadInvalid: return "payload_invalid";
    case LicenseBlockReason::StorageError: return "storage_error";
    case LicenseBlockReason::TransportError: return "transport_error";
    default: return "unknown";
    }
}

inline LicenseBlockReason reason_from_string(const std::string& reason)
{
    if (reason == "disabled") return LicenseBlockReason::Disabled;
    if (reason == "valid") return LicenseBlockReason::Valid;
    if (reason == "no_license") return LicenseBlockReason::NoLicense;
    if (reason == "signature_invalid") return LicenseBlockReason::SignatureInvalid;
    if (reason == "key_unknown") return LicenseBlockReason::KeyUnknown;
    if (reason == "public_key_unconfigured") return LicenseBlockReason::PublicKeyUnconfigured;
    if (reason == "device_mismatch") return LicenseBlockReason::DeviceMismatch;
    if (reason == "status_revoked") return LicenseBlockReason::StatusInactive;
    if (reason == "status_inactive") return LicenseBlockReason::StatusInactive;
    if (reason == "expired") return LicenseBlockReason::Expired;
    if (reason == "sync_overdue") return LicenseBlockReason::SyncOverdue;
    if (reason == "time_untrusted") return LicenseBlockReason::TimeUntrusted;
    if (reason == "payload_time_mismatch") return LicenseBlockReason::PayloadTimeMismatch;
    if (reason == "payload_invalid") return LicenseBlockReason::PayloadInvalid;
    if (reason == "storage_error") return LicenseBlockReason::StorageError;
    if (reason == "transport_error") return LicenseBlockReason::TransportError;
    return LicenseBlockReason::TransportError;
}

} // namespace hd_license

#endif
