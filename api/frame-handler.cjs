const fs = require("node:fs");
const path = require("node:path");
const { createPublicClient, http, formatEther, formatUnits } = require("viem");
const { base: viemBaseChain } = require("viem/chains"); // Ensure this is your correct chain

// Variables to hold dynamically imported modules' exports
let FIREBALL_DROP_ABI_MODULE;
let ERC20_MINIMAL_ABI_MODULE;
let REWARD_TYPE_MODULE;

// Helper to load ESM modules dynamically if not already loaded
async function ensureModulesLoaded() {
  if (!FIREBALL_DROP_ABI_MODULE) {
    FIREBALL_DROP_ABI_MODULE = await import(
      "../src/utils/cjs/FireballDropAbi.cjs"
    );
  }
  if (!ERC20_MINIMAL_ABI_MODULE) {
    ERC20_MINIMAL_ABI_MODULE = await import("../src/utils/cjs/erc20.cjs");
  }
  if (!REWARD_TYPE_MODULE) {
    REWARD_TYPE_MODULE = await import("../src/types/cjs/global.cjs");
  }
}

// --- Environment Variables ---
const CONTRACT_ADDRESS_SERVER = process.env.CONTRACT_ADDRESS;
const ALCHEMY_API_KEY_SERVER = process.env.ALCHEMY_API_KEY;
const APP_BASE_URL = process.env.APP_URL || "https://fireball-rho.vercel.app";

// --- Server-Side Contract Config ---
function getServerConfig() {
  if (!CONTRACT_ADDRESS_SERVER)
    throw new Error(
      "CONTRACT_ADDRESS environment variable is not set for server."
    );
  if (!ALCHEMY_API_KEY_SERVER)
    throw new Error(
      "ALCHEMY_API_KEY environment variable is not set for server."
    );
  if (
    !FIREBALL_DROP_ABI_MODULE ||
    !FIREBALL_DROP_ABI_MODULE.FIREBALL_DROP_ABI
  ) {
    // This check ensures the module and its export are loaded before use.
    throw new Error(
      "FIREBALL_DROP_ABI has not been loaded. Call ensureModulesLoaded first."
    );
  }

  const publicClient = createPublicClient({
    chain: viemBaseChain, // Configure your chain (e.g., base)
    transport: http(
      `https://base-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY_SERVER}`
    ), // Adjust RPC URL structure if needed
  });

  return {
    address: CONTRACT_ADDRESS_SERVER,
    abi: FIREBALL_DROP_ABI_MODULE.FIREBALL_DROP_ABI, // Access the dynamically imported ABI
    publicClient,
  };
}

// --- Server-Side Data Fetching Helpers (minimal versions, adapted from DropDetailPage.tsx) ---
async function getTokenDecimalsServer(tokenAddress) {
  if (tokenAddress === "0x0000000000000000000000000000000000000000") return 18; // ETH
  if (
    !ERC20_MINIMAL_ABI_MODULE ||
    !ERC20_MINIMAL_ABI_MODULE.ERC20_MINIMAL_ABI
  ) {
    throw new Error(
      "ERC20_MINIMAL_ABI has not been loaded. Call ensureModulesLoaded first."
    );
  }
  const { publicClient } = getServerConfig();
  try {
    const decimals = await publicClient.readContract({
      address: tokenAddress,
      abi: ERC20_MINIMAL_ABI_MODULE.ERC20_MINIMAL_ABI, // Access the dynamically imported ABI
      functionName: "decimals",
    });
    return Number(decimals);
  } catch (e) {
    console.warn(
      `[Server Frame Handler] Could not fetch decimals for ${tokenAddress}, defaulting to 18. Error: ${e}`
    );
    return 18;
  }
}

async function formatRewardDisplayServer(
  rawAmount,
  currentRewardType,
  rewardTokenAddress,
  numWinners,
  rewardTokenIds
) {
  if (!REWARD_TYPE_MODULE || !REWARD_TYPE_MODULE.RewardType) {
    throw new Error(
      "RewardType has not been loaded. Call ensureModulesLoaded first."
    );
  }
  const RewardType = REWARD_TYPE_MODULE.RewardType; // Get the actual RewardType object/enum

  if (currentRewardType === RewardType.ETH) {
    // Compare with the values from the dynamically loaded enum
    return `${formatEther(rawAmount)} ETH`;
  } else if (
    currentRewardType === RewardType.USDC ||
    currentRewardType === RewardType.ERC20
  ) {
    const decimals = await getTokenDecimalsServer(rewardTokenAddress);
    const { publicClient } = getServerConfig(); // getServerConfig will ensure its own dependencies are met
    let symbol = "Tokens";
    try {
      symbol = await publicClient.readContract({
        address: rewardTokenAddress,
        abi: ERC20_MINIMAL_ABI_MODULE.ERC20_MINIMAL_ABI, // Access the dynamically imported ABI
        functionName: "symbol",
      });
      // Handle the special case for FIREBALL
      if (typeof symbol === "string" && symbol.toUpperCase() === "FIREBALL") {
        symbol = "fire-ball";
      }
    } catch (e) {
      console.warn(
        `[Server Frame Handler] Could not fetch symbol for ${rewardTokenAddress}, using default. Error: ${e}`
      );
    }
    return `${formatUnits(rawAmount, decimals)} ${symbol}`;
  } else if (currentRewardType === RewardType.NFT) {
    const count =
      rewardTokenIds.length > 0 ? rewardTokenIds.length : numWinners;
    return `${count} NFT(s)`;
  }
  return "N/A";
}

async function getMinimalDropDataForFrame(dropIdStr) {
  try {
    const { publicClient, address: contractAddress, abi } = getServerConfig();
    // Fetching the same structure as in DropDetailPage's getDropInfo
    const dropDetailsArray = await publicClient.readContract({
      address: contractAddress,
      abi,
      functionName: "getDropInfo",
      args: [BigInt(dropIdStr)],
    });

    // Destructure to get the parts needed for reward formatting
    const [
      ,
      ,
      ,
      rawRewardAmountFromContract,
      rewardToken,
      rewardTypeNum,
      rewardTokenIdsBigInt,
      ,
      ,
      ,
      ,
      ,
      ,
      ,
      numWinners,
      ,
    ] = dropDetailsArray;

    const currentRewardType = rewardTypeNum; // This is a number representing the enum value
    const tokenIdsStr = rewardTokenIdsBigInt.map((id) => id.toString());

    const rewardAmountFormatted = await formatRewardDisplayServer(
      rawRewardAmountFromContract,
      currentRewardType,
      rewardToken,
      numWinners,
      tokenIdsStr
    );
    return { rewardAmountFormatted }; // Only return what's needed for the frame title
  } catch (error) {
    console.error(
      `[Server Frame Handler] Error fetching drop data for ${dropIdStr}:`,
      error
    );
    return null;
  }
}

// --- Main Handler ---
module.exports = async function handler(req, res) {
  // Ensure all required ES Modules from src/ are loaded dynamically
  await ensureModulesLoaded();

  const { dropId } = req.query;

  if (typeof dropId !== "string" || !/^\d+$/.test(dropId)) {
    return serveOriginalIndex(res, "Invalid Drop ID format.");
  }

  try {
    const dropData = await getMinimalDropDataForFrame(dropId);

    const frameSpecificDropUrl = `${APP_BASE_URL}/drop/${dropId}`;
    let prizeDescription = dropData
      ? dropData.rewardAmountFormatted
      : "an exciting prize";

    // Workaround: If the reward token is "Fireball", avoid reserved keyword issues
    if (
      typeof prizeDescription === "string" &&
      /\bfireball\b/i.test(prizeDescription)
    ) {
      // Insert a zero-width space to break the keyword
      prizeDescription = prizeDescription.replace(
        /fireball/gi,
        "fireb\u200Ball"
      );
    }

    // FIX: Define the button title
    const frameButtonTitle = `View Drop #${dropId} - ${prizeDescription}!`;

    const frameImageUrl = `${APP_BASE_URL}/image.png`;
    const splashImageUrl = `${APP_BASE_URL}/logo.jpg`;

    const fcFrameMetaContent = JSON.stringify({
      version: "next",
      imageUrl: frameImageUrl,
      button: {
        title: frameButtonTitle.substring(0, 256),
        action: {
          type: "launch_frame",
          url: frameSpecificDropUrl,
          name: "Fireball☄️",
          splashImageUrl: splashImageUrl,
          splashBackgroundColor: "#1f2937",
        },
      },
    });

    // Standard OG tags for better unfurling on other platforms too
    const ogMetaTags = `
      <meta property="og:title" content="Fireball Drop #${dropId} - ${prizeDescription}" />
      <meta property="og:image" content="${frameImageUrl}" />
      <meta property="og:description" content="Join Fireball Drop #${dropId} on Fireball!"/>
      <meta property="og:url" content="${frameSpecificDropUrl}" />
    `;

    const fcFrameMetaTag = `<meta name="fc:frame" content="${fcFrameMetaContent.replace(
      /"/g,
      "&quot;"
    )}" />`;

    let html = fs.readFileSync(
      path.join(process.cwd(), "dist", "index.html"),
      "utf-8"
    );

    // to ensure only our dynamically generated one is present and authoritative.
    html = html.replace(/<meta\s+name="fc:frame"[^>]*>/gi, "");
    html = html.replace(/<meta\s+name="fc:frame-default-for-spa"[^>]*>/gi, "");

    const metaTagsToInject = `\n${fcFrameMetaTag}\n${ogMetaTags}\n`;
    const placeholder = "<!--FC_FRAME_META_TAG_PLACEHOLDER-->";

    if (html.includes(placeholder)) {
      html = html.replace(placeholder, metaTagsToInject);
    } else {
      // Fallback if placeholder is missing, inject before </head>
      html = html.replace("</head>", `${metaTagsToInject}</head>`);
    }

    res.setHeader("Content-Type", "text/html");
    res.status(200).send(html);
  } catch (error) {
    console.error(
      `[Server Frame Handler] General error for drop ${dropId}:`,
      error
    );
    return serveOriginalIndex(
      res,
      `Error processing request: ${error.message}`
    );
  }
};

function serveOriginalIndex(res, reason) {
  console.log(
    `[Server Frame Handler] Serving original index.html. Reason: ${reason}`
  );
  try {
    const indexPath = path.join(process.cwd(), "dist", "index.html");
    const fallbackHtml = fs.readFileSync(indexPath, "utf-8");
    res.setHeader("Content-Type", "text/html");
    res.status(200).send(fallbackHtml);
  } catch (fallbackError) {
    console.error(
      `[Server Frame Handler] Error serving fallback index.html:`,
      fallbackError
    );
    res
      .status(500)
      .send(`Critical error serving fallback: ${fallbackError.message}`);
  }
}
