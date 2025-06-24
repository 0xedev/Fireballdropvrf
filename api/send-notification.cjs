const { isAddress, getAddress } = require("viem");
const { v4: uuidv4 } = require("uuid");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.VITE_PUBLIC_SUPABASE_URL,
  process.env.VITE_PUBLIC_SUPABASE_ANON_KEY
);

const NEYNAR_API_KEY = process.env.NEYNAR_API_KEY;
const NEYNAR_API_USER_BULK_BY_ADDRESS_URL =
  "https://api.neynar.com/v2/farcaster/user/bulk-by-address";
const NEYNAR_API_NOTIFICATIONS_URL =
  "https://api.neynar.com/v2/farcaster/frame/notifications";

const profileCache = new Map();

async function fetchFrameUsersFids() {
  try {
    const { data, error } = await supabase.from("frame_users").select("fid");
    if (error) {
      console.error("[API] Supabase error fetching users:", error);
      return [];
    }
    const fids = data.map((user) => user.fid).filter((fid) => fid);
    console.log("[API] Fetched frame users FIDs:", fids);
    return fids;
  } catch (error) {
    console.error("[API] Error fetching frame users:", error);
    return [];
  }
}

async function fetchFarcasterProfiles(addresses) {
  if (!addresses || addresses.length === 0) return {};
  if (!NEYNAR_API_KEY) {
    console.warn("[API] Neynar API key missing");
    return {};
  }
  const uniqueAddresses = [
    ...new Set(addresses.map((addr) => getAddress(addr))),
  ];
  const results = {};
  const CHUNK_SIZE = 50;

  uniqueAddresses.forEach((addr) => {
    if (profileCache.has(addr)) results[addr] = profileCache.get(addr);
  });

  const addressesToFetch = uniqueAddresses.filter(
    (addr) => !profileCache.has(addr)
  );
  for (let i = 0; i < addressesToFetch.length; i += CHUNK_SIZE) {
    const chunk = addressesToFetch.slice(i, i + CHUNK_SIZE);
    if (chunk.length === 0) continue;
    const addressesParam = chunk.join(",");
    const requestUrl = `${NEYNAR_API_USER_BULK_BY_ADDRESS_URL}?addresses=${addressesParam}`;

    try {
      const response = await fetch(requestUrl, {
        method: "GET",
        headers: { api_key: NEYNAR_API_KEY, accept: "application/json" },
      });

      if (!response.ok) {
        console.warn(`[API] Neynar API error: ${response.status}`);
        chunk.forEach((addr) => {
          if (!profileCache.has(addr)) {
            profileCache.set(addr, {
              fid: null,
              username: null,
              displayName: null,
              pfpUrl: null,
              custodyAddress: addr,
            });
          }
        });
        continue;
      }

      const data = await response.json();
      Object.entries(data).forEach(([addr, users]) => {
        if (!isAddress(addr)) return;
        const normalizedAddr = getAddress(addr);
        if (users && users.length > 0) {
          const user = users[0];
          const profile = {
            fid: user.fid,
            username: user.username,
            displayName: user.display_name,
            pfpUrl: user.pfp_url,
            custodyAddress: normalizedAddr,
          };
          profileCache.set(normalizedAddr, profile);
          results[normalizedAddr] = profile;
        } else {
          profileCache.set(normalizedAddr, {
            fid: null,
            username: null,
            displayName: null,
            pfpUrl: null,
            custodyAddress: normalizedAddr,
          });
        }
      });
    } catch (error) {
      console.error(`[API] Error fetching profiles:`, error);
    }
  }
  return results;
}

function getDisplayName(profile, address) {
  if (profile && (profile.displayName || profile.username)) {
    return profile.displayName || profile.username;
  }
  if (typeof address === "string" && address.length >= 10) {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  }
  return "unknown address";
}

async function sendNeynarNotification(targetFids, notification, filters = {}) {
  if (!NEYNAR_API_KEY) throw new Error("Neynar API key missing");
  if (!targetFids || targetFids.length === 0) {
    console.warn("[API] No target FIDs provided");
    return { success: false, message: "No target FIDs provided" };
  }

  const options = {
    method: "POST",
    headers: {
      "x-api-key": NEYNAR_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      target_fids: targetFids,
      notification: {
        ...notification,
        uuid: uuidv4(),
      },
      filters,
    }),
  };

  try {
    const response = await fetch(NEYNAR_API_NOTIFICATIONS_URL, options);
    const data = await response.json();
    if (!response.ok) throw new Error(`Neynar API error: ${response.status}`);
    return { success: true, message: "Notification sent", data };
  } catch (error) {
    console.error("[API] Error sending notification:", error);
    return { success: false, message: `Failed to send: ${error.message}` };
  }
}

async function handleNotificationLogic(notificationData) {
  try {
    if (notificationData.creatorAddress && !notificationData.hostAddress) {
      notificationData.hostAddress = notificationData.creatorAddress;
    }

    if (
      [
        "game-created",
        "game-sponsored",
        "game-joined",
        "winners-selected",
      ].includes(notificationData.category) &&
      !notificationData.dropId
    ) {
      throw new Error("dropId required");
    }

    const addressesToFetch = [];
    if (
      notificationData.hostAddress &&
      isAddress(notificationData.hostAddress)
    ) {
      addressesToFetch.push(getAddress(notificationData.hostAddress));
    }
    if (
      notificationData.sponsorAddress &&
      isAddress(notificationData.sponsorAddress)
    ) {
      addressesToFetch.push(getAddress(notificationData.sponsorAddress));
    }
    if (
      notificationData.participantAddress &&
      isAddress(notificationData.participantAddress)
    ) {
      addressesToFetch.push(getAddress(notificationData.participantAddress));
    }
    if (
      notificationData.winnerAddresses &&
      Array.isArray(notificationData.winnerAddresses)
    ) {
      notificationData.winnerAddresses
        .filter((addr) => isAddress(addr))
        .forEach((addr) => addressesToFetch.push(getAddress(addr)));
    }

    const profiles = await fetchFarcasterProfiles(addressesToFetch);

    let targetFids = notificationData.targetFids || [];
    let notification = {};
    const dropUrl = notificationData.dropId
      ? `https://fireball-rho.vercel.app/drop/${notificationData.dropId}`
      : "https://fireball-rho.vercel.app";

    const rewardDisplay = notificationData.tokenSymbol
      ? `${notificationData.rewardAmount || "N/A"} ${
          notificationData.tokenSymbol
        }`
      : notificationData.rewardAmount || "N/A";

    switch (notificationData.category) {
      case "welcome":
        if (!Array.isArray(targetFids) || targetFids.length === 0) {
          throw new Error("Valid targetFids required");
        }
        notification = {
          title: "Welcome to Fireball! ☄️",
          body: "Join exciting drops and win rewards!",
          target_url: dropUrl,
        };
        break;

      case "game-created":
        if (
          !notificationData.hostAddress ||
          !isAddress(notificationData.hostAddress)
        ) {
          throw new Error("Valid hostAddress required");
        }
        const hostProfile = profiles[notificationData.hostAddress];
        const hostDisplay = getDisplayName(
          hostProfile,
          notificationData.hostAddress
        );
        targetFids = await fetchFrameUsersFids();
        notification = {
          title: "New Fireball Drop Created! ☄️",
          body: `Drop #${
            notificationData.dropId
          } by ${hostDisplay}: ${rewardDisplay} prize for up to ${
            notificationData.maxParticipants || "N/A"
          } participants!`,
          target_url: dropUrl,
        };
        break;

      case "game-sponsored":
        if (
          !isAddress(notificationData.hostAddress) ||
          !isAddress(notificationData.sponsorAddress)
        ) {
          throw new Error("Valid host and sponsor addresses required");
        }
        const hostSponsoredProfile = profiles[notificationData.hostAddress];
        const sponsorProfile = profiles[notificationData.sponsorAddress];
        const hostSponsoredDisplay = getDisplayName(
          hostSponsoredProfile,
          notificationData.hostAddress
        );
        const sponsorDisplay = getDisplayName(
          sponsorProfile,
          notificationData.sponsorAddress
        );
        targetFids = await fetchFrameUsersFids();
        notification = {
          title: "Drop Sponsored! 🎉",
          body: `Drop #${notificationData.dropId} sponsored by ${sponsorDisplay} for ${hostSponsoredDisplay}. Prize: ${rewardDisplay}.`,
          target_url: dropUrl,
        };
        break;

      case "game-joined":
        if (!isAddress(notificationData.participantAddress)) {
          throw new Error("Valid participant address required");
        }
        const participantProfile =
          profiles[notificationData.participantAddress];
        const participantDisplay =
          notificationData.participantName ||
          getDisplayName(
            participantProfile,
            notificationData.participantAddress
          );
        targetFids = [
          ...(profiles[notificationData.hostAddress]?.fid
            ? [profiles[notificationData.hostAddress].fid]
            : []),
          ...(participantProfile?.fid ? [participantProfile.fid] : []),
        ];
        notification = {
          title: "New Participant! 🙌",
          body: `${participantDisplay} joined Drop #${notificationData.dropId}! Prize: ${rewardDisplay}.`,
          target_url: dropUrl,
        };
        break;

      case "winners-selected":
        if (
          !Array.isArray(notificationData.winnerAddresses) ||
          notificationData.winnerAddresses.some((addr) => !isAddress(addr))
        ) {
          throw new Error("Valid winner addresses required");
        }
        const winnerFids = notificationData.winnerAddresses
          .map((addr) => profiles[getAddress(addr)]?.fid)
          .filter((fid) => fid);
        targetFids = winnerFids;
        if (targetFids.length === 0) {
          console.warn("[API] No valid FIDs for winners");
          return { success: false, message: "No valid FIDs for winners" };
        }
        const winnerDisplays = notificationData.winnerAddresses
          .map((addr) => getDisplayName(profiles[getAddress(addr)], addr))
          .join(", ");
        notification = {
          title: "Winners Announced! 🏆",
          body: `Drop #${notificationData.dropId} winners: ${winnerDisplays}. Prize: ${rewardDisplay}.`,
          target_url: dropUrl,
        };
        break;

      default:
        throw new Error(`Unsupported category: ${notificationData.category}`);
    }

    return await sendNeynarNotification(targetFids, notification);
  } catch (error) {
    console.error(
      `Error sending ${notificationData.category} notification:`,
      error
    );
    return { success: false, message: `Failed to send: ${error.message}` };
  }
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res
      .status(405)
      .json({ success: false, message: `Method ${req.method} Not Allowed` });
  }

  const notificationData = req.body;
  if (!notificationData || !notificationData.category) {
    return res.status(400).json({
      success: false,
      message: "Invalid request: Expected JSON with 'category'",
    });
  }

  try {
    const result = await handleNotificationLogic(notificationData);
    return res.status(result.success ? 200 : 500).json(result);
  } catch (error) {
    console.error(
      `[API] Error processing ${notificationData.category}:`,
      error
    );
    return res.status(500).json({
      success: false,
      message: `Server error: ${error.message}`,
    });
  }
};
