import React, { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAccount, useWalletClient } from "wagmi";
import {
  formatEther,
  formatUnits,
  getAddress,
  isAddress,
  decodeEventLog,
} from "viem";
import { toast } from "react-toastify";
import PlinkoBoard from "../components/PlinkoBoard";
import { sdk } from "@farcaster/frame-sdk";
import { getContractConfig, WinnersSelectedEvent } from "../utils/contract";
import { DropInfo, RewardType, Participant } from "../types/global";
import { ERC20_MINIMAL_ABI } from "../utils/erc20";
import { useFarcasterProfiles } from "../hooks/useFarcasterProfiles";
import { Share } from "lucide-react";

// Helper function to get token decimals
async function getTokenDecimals(tokenAddress: `0x${string}`): Promise<number> {
  if (tokenAddress === "0x0000000000000000000000000000000000000000") {
    return 18;
  }
  const { publicClient } = getContractConfig();
  try {
    const decimals = (await publicClient.readContract({
      address: tokenAddress,
      abi: ERC20_MINIMAL_ABI,
      functionName: "decimals",
    })) as number;
    return Number(decimals);
  } catch (e) {
    console.warn(
      `Could not fetch decimals for ${tokenAddress}, defaulting to 18. Error: ${e}`
    );
    return 18;
  }
}

// Helper to format reward amount based on type for display
async function formatRewardDisplay(
  rawAmount: bigint,
  rewardType: RewardType,
  rewardTokenAddress: `0x${string}`,
  numWinners: number,
  rewardTokenIds: string[]
): Promise<string> {
  if (rewardType === RewardType.ETH) {
    return `${formatEther(rawAmount)} ETH`;
  } else if (
    rewardType === RewardType.USDC ||
    rewardType === RewardType.ERC20
  ) {
    const decimals = await getTokenDecimals(rewardTokenAddress);
    const { publicClient } = getContractConfig();
    let symbol = "Tokens";
    try {
      symbol = (await publicClient.readContract({
        address: rewardTokenAddress,
        abi: ERC20_MINIMAL_ABI,
        functionName: "symbol",
      })) as string;
      // Special case for FIREBALL
      if (typeof symbol === "string" && symbol.toUpperCase() === "FIREBALL") {
        symbol = "fire-ball";
      }
    } catch (e) {
      console.warn(
        `Could not fetch symbol for ${rewardTokenAddress}, using default. Error: ${e}`
      );
    }
    return `${formatUnits(rawAmount, decimals)} ${symbol}`;
  } else if (rewardType === RewardType.NFT) {
    const count =
      rewardTokenIds.length > 0 ? rewardTokenIds.length : numWinners;
    return `${count} NFT(s)`;
  }
  return "N/A";
}

// Helper to format entry fee for display
async function formatEntryFeeDisplay(
  rawAmount: bigint,
  isPaidEntry: boolean,
  dropRewardType: RewardType,
  entryFeeTokenAddress: `0x${string}`
): Promise<string> {
  if (!isPaidEntry || rawAmount === 0n) {
    return "Free";
  }
  if (
    dropRewardType === RewardType.USDC ||
    dropRewardType === RewardType.ERC20
  ) {
    const decimals = await getTokenDecimals(entryFeeTokenAddress);
    const { publicClient } = getContractConfig();
    let symbol = "Tokens";
    try {
      symbol = (await publicClient.readContract({
        address: entryFeeTokenAddress,
        abi: ERC20_MINIMAL_ABI,
        functionName: "symbol",
      })) as string;
      // Special case for FIREBALL
      if (typeof symbol === "string" && symbol.toUpperCase() === "FIREBALL") {
        symbol = "fire-ball";
      }
    } catch (e) {
      console.warn(
        `Could not fetch symbol for entry fee token ${entryFeeTokenAddress}, using default. Error: ${e}`
      );
    }
    return `${formatUnits(rawAmount, decimals)} ${symbol}`;
  } else {
    return `${formatEther(rawAmount)} ETH`;
  }
}

interface ExtendedDropInfo extends DropInfo {
  rawEntryFee: bigint;
  rawRewardAmount: bigint;
}

const DropDetailPage: React.FC = () => {
  const { dropId } = useParams<{ dropId: string }>();
  const navigate = useNavigate();
  const { address, isConnected, isConnecting } = useAccount();
  const { data: walletClient, isLoading: isWalletClientLoading } =
    useWalletClient();

  const [dropInfo, setDropInfo] = useState<ExtendedDropInfo | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [loadingData, setLoadingData] = useState<boolean>(true);
  const [actionInProgress, setActionInProgress] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [, setIsCancelledForUI] = useState<boolean>(false);
  const [winnerIndices, setWinnerIndices] = useState<number[]>([]);
  const [animateWinners, setAnimateWinners] = useState<boolean>(false);
  const rows = 16;
  const plinkoBoardRef = useRef<{ dropBall: () => Promise<number[]> }>(null);

  const { profiles: fcProfiles, getProfilesByAddresses } =
    useFarcasterProfiles();

  const fetchAndSetDropInfo = useCallback(
    async (currentDropId: string, isInitialLoad = false) => {
      console.log(
        `[DropDetail] fetchAndSetDropInfo called for dropId: ${currentDropId}. Initial: ${isInitialLoad}`
      );
      if (isInitialLoad) {
        setLoadingData(true);
      }
      const addressesToFetchProfilesFor = new Set<string>();

      try {
        const {
          publicClient,
          address: contractAddress,
          abi,
        } = getContractConfig();

        const dropDetailsArray = (await publicClient.readContract({
          address: contractAddress as `0x${string}`,
          abi,
          functionName: "getDropInfo",
          args: [BigInt(currentDropId)],
        })) as readonly [
          `0x${string}`,
          `0x${string}`,
          bigint,
          bigint,
          `0x${string}`,
          number,
          readonly bigint[],
          bigint,
          bigint,
          boolean,
          boolean,
          boolean,
          boolean,
          boolean,
          number,
          bigint,
          readonly `0x${string}`[]
        ];

        const [
          host,
          sponsor,
          rawEntryFee,
          rawRewardAmountFromContract,
          rewardToken,
          rewardTypeNum,
          rewardTokenIdsBigInt,
          maxParticipants,
          currentParticipants,
          isActive,
          isCompleted,
          isPaidEntry,
          isManualSelection,
          isSponsored,
          numWinners,
          fundingDeadline,
          winnersAddresses,
        ] = dropDetailsArray;
        console.log("[DropDetail] Fetched raw dropInfo from contract:", {
          host,
          sponsor,
          rawEntryFee: rawEntryFee.toString(),
          rawRewardAmountFromContract: rawRewardAmountFromContract.toString(),
          rewardToken,
          rewardTypeNum,
          isActive,
          isCompleted,
          isPaidEntry,
          currentParticipants: currentParticipants.toString(),
          maxParticipants: maxParticipants.toString(),
        });

        const currentRewardType = rewardTypeNum as RewardType;
        if (isAddress(host)) addressesToFetchProfilesFor.add(getAddress(host));
        if (
          isSponsored &&
          sponsor !== "0x0000000000000000000000000000000000000000" &&
          isAddress(sponsor)
        ) {
          addressesToFetchProfilesFor.add(getAddress(sponsor));
        }

        if (
          isSponsored &&
          sponsor === "0x0000000000000000000000000000000000000000" &&
          isActive
        ) {
          toast.error("This sponsored game is not funded yet.");
          navigate("/available");
          throw new Error("Unfunded sponsored game");
        }

        const tokenIdsStr = rewardTokenIdsBigInt.map((id) => id.toString());
        const entryFeeTokenForFormatting =
          isPaidEntry &&
          (currentRewardType === RewardType.ERC20 ||
            currentRewardType === RewardType.USDC)
            ? rewardToken
            : "0x0000000000000000000000000000000000000000";
        const formattedEntryFee = await formatEntryFeeDisplay(
          rawEntryFee,
          isPaidEntry,
          currentRewardType,
          entryFeeTokenForFormatting
        );
        const formattedRewardAmount = await formatRewardDisplay(
          rawRewardAmountFromContract,
          currentRewardType,
          rewardToken,
          numWinners,
          tokenIdsStr
        );

        const [participantAddressesFromContract, participantNamesFromContract] =
          (await publicClient.readContract({
            address: contractAddress as `0x${string}`,
            abi,
            functionName: "getDropParticipants",
            args: [BigInt(currentDropId)],
          })) as [string[], string[]];

        const participantList = participantAddressesFromContract.map(
          (addr: string, index: number) => {
            if (isAddress(addr))
              addressesToFetchProfilesFor.add(getAddress(addr));
            return {
              address: addr,
              name:
                participantNamesFromContract[index] || `User-${addr.slice(-4)}`,
              slot: index,
            };
          }
        );
        setParticipants(participantList);

        winnersAddresses.forEach((addr) => {
          if (isAddress(addr))
            addressesToFetchProfilesFor.add(getAddress(addr));
        });

        const newDropInfoState: ExtendedDropInfo = {
          id: Number(currentDropId),
          host,
          sponsor,
          entryFee: formattedEntryFee,
          rewardAmount: formattedRewardAmount,
          rawEntryFee,
          rawRewardAmount: rawRewardAmountFromContract,
          rewardToken,
          rewardType: currentRewardType,
          rewardTokenIds: tokenIdsStr,
          maxParticipants: Number(maxParticipants),
          currentParticipants: Number(currentParticipants),
          isActive,
          isCompleted,
          isPaidEntry,
          isManualSelection,
          isSponsored,
          numWinners,
          fundingDeadline: Number(fundingDeadline),
          winners: [...winnersAddresses],
        };
        console.log("[DropDetail] Setting dropInfo state:", newDropInfoState);
        setDropInfo(newDropInfoState);

        setIsCancelledForUI(
          !isActive && isCompleted && winnersAddresses.length === 0
        );

        if (isCompleted && winnersAddresses.length > 0) {
          const indices = winnersAddresses
            .map((winnerAddr: string) =>
              participantList.findIndex(
                (p) => getAddress(p.address) === getAddress(winnerAddr)
              )
            )
            .filter((index) => index !== -1);

          if (indices.length > 0) {
            console.log(
              "[DropDetail] Setting winner indices for animation:",
              indices
            );
            setWinnerIndices(indices);
            setAnimateWinners(true);
          }
        }

        if (addressesToFetchProfilesFor.size > 0) {
          console.log(
            "[DropDetail] Requesting Farcaster profiles for:",
            Array.from(addressesToFetchProfilesFor)
          );
          getProfilesByAddresses(Array.from(addressesToFetchProfilesFor));
        }
      } catch (err: any) {
        setError(err.message || "Failed to fetch drop info");
        if (err.message !== "Unfunded sponsored game") {
          toast.error(err.message || "Failed to fetch drop info");
        }
        console.error("[DropDetail] Error in fetchAndSetDropInfo:", err);
      } finally {
        if (isInitialLoad) {
          setLoadingData(false);
        }
      }
    },
    [dropId, navigate, getProfilesByAddresses]
  );

  // Format prize amounts for notification
  const formatPrizeAmounts = async (
    prizeAmounts: bigint[],
    rewardType: RewardType,
    rewardToken: `0x${string}`,
    numWinners: number
  ): Promise<string> => {
    try {
      if (rewardType === RewardType.NFT) {
        return `${numWinners} NFT(s)`;
      }
      const decimals = await getTokenDecimals(rewardToken);
      let symbol =
        rewardType === RewardType.ETH
          ? "ETH"
          : await (async () => {
              try {
                const { publicClient } = getContractConfig();
                let s = (await publicClient.readContract({
                  address: rewardToken,
                  abi: ERC20_MINIMAL_ABI,
                  functionName: "symbol",
                })) as string;
                // Special case for FIREBALL
                if (typeof s === "string" && s.toUpperCase() === "FIREBALL") {
                  s = "fire-ball";
                }
                return s;
              } catch (e) {
                console.warn(
                  `Could not fetch symbol for ${rewardToken}, using default`
                );
                return "Tokens";
              }
            })();
      return prizeAmounts
        .map((amount) => `${formatUnits(amount, decimals)} ${symbol}`)
        .join(", ");
    } catch (e) {
      console.error(`[FormatPrizeAmounts] Error: ${e}`);
      return `${numWinners} Prize(s)`;
    }
  };
  useEffect(() => {
    if (dropId) {
      fetchAndSetDropInfo(dropId, true);
    }
    const { publicClient, address: contractAddress, abi } = getContractConfig();
    const unwatchers: (() => void)[] = [];

    const watchEvent = (eventName: string, callback: (log: any) => void) => {
      return publicClient.watchContractEvent({
        address: contractAddress as `0x${string}`,
        abi,
        eventName,
        onLogs: (logs) =>
          logs.forEach((log) => {
            const typedLog = log as unknown as { args: { dropId: bigint } };
            if (typedLog.args?.dropId?.toString() === dropId) {
              callback(log);
            }
          }),
      });
    };

    if (dropId) {
      unwatchers.push(
        watchEvent("ParticipantJoined", () => {
          console.log("[Event] ParticipantJoined detected");
          fetchAndSetDropInfo(dropId, false);
        })
      );
      unwatchers.push(
        watchEvent("WinnersSelected", async (log) => {
          console.log("[Event] WinnersSelected detected", log);
          try {
            const decodedEvent = decodeEventLog({
              abi: [WinnersSelectedEvent],
              data: log.data,
              topics: log.topics,
            }) as unknown as {
              eventName: "WinnersSelected";
              args: {
                dropId: bigint;
                winners: `0x${string}`[];
                prizeAmounts: bigint[];
                platformFee: bigint;
              };
            };
            if (decodedEvent.eventName !== "WinnersSelected") return;
            const { winners, prizeAmounts, platformFee } = decodedEvent.args;
            if (!dropInfo) return;

            // Format prize amounts for notification
            const formattedPrizeAmounts = await formatPrizeAmounts(
              prizeAmounts,
              dropInfo.rewardType,
              dropInfo.rewardToken as `0x${string}`,
              dropInfo.numWinners
            );
            const tokenSymbol =
              dropInfo.rewardType === RewardType.ETH
                ? "ETH"
                : dropInfo.rewardType === RewardType.USDC
                ? "USDC"
                : dropInfo.rewardType === RewardType.ERC20
                ? await (async () => {
                    try {
                      const { publicClient } = getContractConfig();
                      return (await publicClient.readContract({
                        address: dropInfo.rewardToken as `0x${string}`,
                        abi: ERC20_MINIMAL_ABI,
                        functionName: "symbol",
                      })) as string;
                    } catch (e) {
                      return "Tokens";
                    }
                  })()
                : "NFT";
            const rewardAmount = formattedPrizeAmounts
              .split(", ")[0]
              .split(" ")[0]; // First prize amount

            // Send winners-selected notification
            const notificationPayload = {
              category: "winners-selected",
              dropId,
              winnerAddresses: winners as `0x${string}`[],
              prizeAmounts: formattedPrizeAmounts,
              rewardType: dropInfo.rewardType,
              rewardAmount,
              tokenSymbol,
              platformFee: formatEther(platformFee),
              transactionHash: log.transactionHash,
            };

            const response = await fetch("/api/send-notification", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(notificationPayload),
            });

            if (!response.ok) {
              const errorData = await response.json();
              console.error(
                "[WinnersSelected] Notification failed:",
                errorData.message
              );
              toast.warn(`Notification failed: ${errorData.message}`);
            } else {
              console.log("[WinnersSelected] Notification sent");
            }

            toast.success(`Winners for Drop #${dropId} selected!`);
            fetchAndSetDropInfo(dropId, false);
          } catch (e) {
            console.error("[WinnersSelected] Error processing event:", e);
            toast.warn("Failed to process winner selection");
          }
        })
      );
      unwatchers.push(
        watchEvent("DropCancelled", () => {
          console.log("[Event] DropCancelled detected");
          fetchAndSetDropInfo(dropId, false);
        })
      );
      unwatchers.push(
        watchEvent("GameFunded", () => {
          console.log("[Event] GameFunded detected");
          fetchAndSetDropInfo(dropId, false);
        })
      );
    }
    return () => {
      unwatchers.forEach((unwatch) => unwatch());
    };
  }, [dropId, fetchAndSetDropInfo, dropInfo]);

  useEffect(() => {
    if (dropInfo && dropId) {
      const metaTagContent = JSON.stringify({
        version: "next",
        imageUrl: "https://fireball-rho.vercel.app/image.png",
        button: {
          title: `View Drop #${dropId} - ${dropInfo.rewardAmount} Prize!`,
          action: {
            type: "launch_frame",
            url: `https://fireball-rho.vercel.app/drop/${dropId}`,
            name: "Fireball☄️",
            splashImageUrl: "https://fireball-rho.vercel.app/logo.jpg",
            splashBackgroundColor: "#1f2937",
          },
        },
      });
      let metaTag = document.querySelector('meta[name="fc:frame"]');
      if (metaTag) {
        metaTag.setAttribute("content", metaTagContent);
      } else {
        metaTag = document.createElement("meta");
        metaTag.setAttribute("name", "fc:frame");
        metaTag.setAttribute("content", metaTagContent);
        document.head.appendChild(metaTag);
      }
      return () => {
        const defaultFcFrame = document.querySelector(
          'meta[name="fc:frame-default-for-spa"]'
        );
        if (defaultFcFrame && metaTag) {
          metaTag.setAttribute(
            "content",
            defaultFcFrame.getAttribute("content") || ""
          );
        }
      };
    }
  }, [dropId, dropInfo]);

  const joinDrop = async () => {
    console.log(
      "[joinDrop] Attempting to join drop. Current DropInfo State:",
      dropInfo
    );
    if (
      isConnecting ||
      isWalletClientLoading ||
      !walletClient ||
      !address ||
      !dropInfo ||
      !dropId
    ) {
      toast.error("Wallet not ready or drop info missing.");
      console.error("[joinDrop] Pre-condition failed (wallet/dropInfo):", {
        isConnected,
        walletClient,
        address,
        dropInfo,
        dropId,
      });
      return;
    }

    console.log(
      `[joinDrop] Pre-flight check: isActive=${dropInfo.isActive}, isCompleted=${dropInfo.isCompleted}, currentParticipants=${dropInfo.currentParticipants}, maxParticipants=${dropInfo.maxParticipants}`
    );
    const alreadyJoined = participants.some(
      (p) => getAddress(p.address) === getAddress(address)
    );
    console.log(`[joinDrop] Pre-flight check: alreadyJoined=${alreadyJoined}`);

    if (!dropInfo.isActive) {
      toast.error("This drop is no longer active.");
      return;
    }
    if (dropInfo.isCompleted) {
      toast.error("This drop has already ended.");
      return;
    }
    if (alreadyJoined) {
      toast.error("You have already joined this drop.");
      return;
    }
    if (dropInfo.currentParticipants >= dropInfo.maxParticipants) {
      toast.error("This drop is full.");
      return;
    }
    if (
      dropInfo.isSponsored &&
      dropInfo.sponsor === "0x0000000000000000000000000000000000000000"
    ) {
      toast.error("This sponsored game is not funded yet.");
      return;
    }
    if (dropInfo.host && getAddress(dropInfo.host) === getAddress(address)) {
      toast.error("As the host, you cannot join your own drop.");
      return;
    }

    setActionInProgress(true);
    setError(null);
    try {
      const {
        publicClient,
        address: contractAddress,
        abi,
      } = getContractConfig();
      let valueToSend = 0n;

      console.log(
        "[joinDrop] Drop type for entry fee:",
        dropInfo.rewardType,
        "Is paid entry:",
        dropInfo.isPaidEntry
      );
      console.log(
        "[joinDrop] Raw entry fee from state for transaction:",
        dropInfo.rawEntryFee?.toString()
      );

      if (
        dropInfo.isPaidEntry &&
        (dropInfo.rewardType === RewardType.ERC20 ||
          dropInfo.rewardType === RewardType.USDC)
      ) {
        const entryFeeTokenAddress = dropInfo.rewardToken as `0x${string}`;
        const entryFeeInSmallestUnit = dropInfo.rawEntryFee;

        if (entryFeeInSmallestUnit === 0n) {
          throw new Error("Entry fee cannot be zero for a paid drop.");
        }

        // Check token balance
        const balance = (await publicClient.readContract({
          address: entryFeeTokenAddress,
          abi: ERC20_MINIMAL_ABI,
          functionName: "balanceOf",
          args: [address],
        })) as bigint;
        if (balance < entryFeeInSmallestUnit) {
          throw new Error(
            `Insufficient ${dropInfo.entryFee.split(" ")[1]} balance to join.`
          );
        }

        console.log(
          `[joinDrop] ERC20 Paid Entry. Token: ${entryFeeTokenAddress}, Amount (raw): ${entryFeeInSmallestUnit.toString()}`
        );
        toast.info(
          `Approving ${dropInfo.entryFee} for FireballDrop contract...`
        );
        const approveTx = await walletClient.writeContract({
          address: entryFeeTokenAddress,
          abi: ERC20_MINIMAL_ABI,
          functionName: "approve",
          args: [contractAddress, entryFeeInSmallestUnit],
        });
        console.log("[joinDrop] Approval transaction sent:", approveTx);
        await publicClient.waitForTransactionReceipt({ hash: approveTx });
        toast.success("Approval successful! Joining drop...");
      } else if (
        dropInfo.isPaidEntry &&
        dropInfo.rewardType === RewardType.ETH
      ) {
        valueToSend = dropInfo.rawEntryFee;
        console.log(
          `[joinDrop] ETH Paid Entry. Value to send: ${valueToSend.toString()} wei`
        );
        if (valueToSend === 0n) {
          throw new Error("Entry fee cannot be zero for a paid ETH drop.");
        }
        // Check ETH balance
        const ethBalance = await publicClient.getBalance({ address });
        if (ethBalance < valueToSend) {
          throw new Error("Insufficient ETH balance to join.");
        }
      } else {
        console.log("[joinDrop] Free entry.");
        if (valueToSend !== 0n) {
          console.warn(
            "[joinDrop] Value to send is not 0 for a free entry, correcting."
          );
          valueToSend = 0n;
        }
      }

      const fcContext = await sdk.context;
      const participantName =
        fcContext?.user?.displayName ||
        fcContext?.user?.username ||
        `User-${address.slice(-4)}`;
      console.log(`[joinDrop] Participant name: ${participantName}`);
      console.log(
        `[joinDrop] Calling contract 'joinDrop' with dropId: ${dropId}, name: ${participantName}, value: ${valueToSend.toString()}`
      );

      const hash = await walletClient.writeContract({
        address: contractAddress as `0x${string}`,
        abi,
        functionName: "joinDrop",
        args: [BigInt(dropId), participantName],
        value: valueToSend,
      });
      console.log("[joinDrop] joinDrop transaction sent:", hash);
      await publicClient.waitForTransactionReceipt({ hash });

      // Send game-joined notification by calling the API endpoint
      try {
        const notificationPayload = {
          category: "game-joined",
          dropId: dropId,
          participantAddress: address,
          participantName,
          entryFee: dropInfo.entryFee,
          rewardType: dropInfo.rewardType,
          transactionHash: hash,
        };

        const response = await fetch("/api/send-notification", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(notificationPayload),
        });

        if (!response.ok) {
          const errorData = await response.json();
          console.error(
            "Failed to send game-joined notification:",
            errorData.message
          );
        }
      } catch (notificationError) {
        console.error(
          "Error calling send-notification API for game-joined:",
          notificationError
        );
      }

      // Show success toast with share button
      toast.success(
        ({ closeToast }) => (
          <div className="flex flex-col items-center gap-2">
            <span>Joined Drop #{dropId} successfully!</span>
            <button
              onClick={async () => {
                const shareText = `I just joined Fireball Drop #${dropId} with a ${dropInfo.rewardAmount} prize! Join now before it's full!`;
                const shareUrl = `https://fireball-rho.vercel.app/drop/${dropId}`;
                try {
                  await sdk.actions.composeCast({
                    text: shareText,
                    embeds: [shareUrl],
                  });
                  console.log("Shared join drop:", shareText, shareUrl);
                  closeToast();
                } catch (error) {
                  console.error("Failed to share join drop:", error);
                  toast.error("Could not open Farcaster composer to share.");
                }
              }}
              className="py-1.5 px-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors duration-200 shadow-lg flex items-center gap-1"
            >
              <Share className="h-4 w-4" />
              Share
            </button>
          </div>
        ),
        {
          autoClose: false,
          closeOnClick: false,
          draggable: false,
        }
      );

      fetchAndSetDropInfo(dropId, false);
    } catch (err: any) {
      const errorMessage =
        err.shortMessage || err.message?.split("(")[0] || "Failed to join drop";
      setError(errorMessage);
      toast.error(errorMessage);
      console.error("[joinDrop] Error joining drop:", err);
    } finally {
      setActionInProgress(false);
    }
  };

  const selectWinnersManually = async (): Promise<number[]> => {
    if (
      isConnecting ||
      isWalletClientLoading ||
      !walletClient ||
      !address ||
      !dropInfo ||
      !dropId
    ) {
      toast.error("Wallet not ready or drop info missing.");
      return [];
    }
    setActionInProgress(true);
    setError(null);
    try {
      const {
        publicClient,
        address: contractAddress,
        abi,
      } = getContractConfig();
      if (dropInfo.currentParticipants < dropInfo.numWinners)
        throw new Error("Not enough participants.");
      if (!dropInfo.isActive) throw new Error("Drop is not active.");
      if (dropInfo.isCompleted) throw new Error("Drop is already completed.");

      const hash = await walletClient.writeContract({
        address: contractAddress as `0x${string}`,
        abi,
        functionName: "selectWinnersManually",
        args: [BigInt(dropId)],
      });
      toast.info("Selecting winners... please wait.");
      const receipt = await publicClient.waitForTransactionReceipt({ hash });

      // Parse WinnersSelected event
      let newWinnerAddresses: `0x${string}`[] = [];
      try {
        for (const log of receipt.logs) {
          if (log.address.toLowerCase() !== contractAddress.toLowerCase())
            continue;
          try {
            const decodedEvent = decodeEventLog({
              abi: [WinnersSelectedEvent],
              data: log.data,
              topics: log.topics,
            }) as unknown as {
              eventName: "WinnersSelected";
              args: {
                dropId: bigint;
                winners: `0x${string}`[];
                prizeAmounts: bigint[];
                platformFee: bigint;
              };
            };
            if (
              decodedEvent.eventName === "WinnersSelected" &&
              decodedEvent.args.dropId.toString() === dropId
            ) {
              newWinnerAddresses = decodedEvent.args.winners;
              console.log(`[SelectWinners] Parsed WinnersSelected:`, {
                dropId,
                winners: newWinnerAddresses,
                prizeAmounts: decodedEvent.args.prizeAmounts.map((p) =>
                  p.toString()
                ),
                platformFee: decodedEvent.args.platformFee.toString(),
              });
              break;
            }
          } catch (e) {
            console.warn(`[SelectWinners] Could not decode log: ${e}`);
          }
        }
      } catch (e) {
        console.error(
          `[SelectWinners] Error parsing WinnersSelected event: ${e}`
        );
        toast.warn(
          "Failed to parse winner selection event, refetching data..."
        );
      }

      // Fallback: Fetch latest drop info if event parsing fails
      if (newWinnerAddresses.length === 0) {
        console.log("[SelectWinners] Falling back to getDropInfo");
        const latestDropInfo = (await publicClient.readContract({
          address: contractAddress as `0x${string}`,
          abi,
          functionName: "getDropInfo",
          args: [BigInt(dropId)],
        })) as any[];
        newWinnerAddresses = latestDropInfo[16] as `0x${string}`[];
      }

      // Get participant addresses for indexing
      const [participantAddressesFromContract] =
        (await publicClient.readContract({
          address: contractAddress as `0x${string}`,
          abi,
          functionName: "getDropParticipants",
          args: [BigInt(dropId)],
        })) as [string[], string[]];

      const indices = newWinnerAddresses
        .map((winnerAddr: `0x${string}`) =>
          participantAddressesFromContract.findIndex(
            (pAddr) => getAddress(pAddr) === getAddress(winnerAddr)
          )
        )
        .filter((index) => index !== -1);

      setDropInfo((prev) =>
        prev
          ? {
              ...prev,
              winners: newWinnerAddresses,
              isCompleted: true,
              isActive: false,
            }
          : null
      );
      setWinnerIndices(indices);
      setAnimateWinners(true);
      return indices;
    } catch (err: any) {
      const errorMessage =
        err.shortMessage ||
        err.message?.split("(")[0] ||
        "Failed to select winners";
      setError(errorMessage);
      toast.error(errorMessage);
      console.error("[SelectWinners] Error selecting winners:", err);
      throw err;
    } finally {
      setActionInProgress(false);
    }
  };

  const cancelDrop = async () => {
    if (
      isConnecting ||
      isWalletClientLoading ||
      !walletClient ||
      !address ||
      !dropInfo ||
      !dropId
    ) {
      toast.error("Wallet not ready or drop info missing.");
      return;
    }
    if (
      dropInfo.currentParticipants >= dropInfo.maxParticipants &&
      !dropInfo.isCompleted
    ) {
      toast.error(
        "Cannot cancel a drop that is full and not yet completed via winner selection."
      );
      return;
    }
    if (!dropInfo.isActive) {
      toast.error("Drop is not active to be cancelled.");
      return;
    }
    if (dropInfo.isCompleted) {
      toast.error("Drop is already completed.");
      return;
    }

    setActionInProgress(true);
    setError(null);
    try {
      const {
        publicClient,
        address: contractAddress,
        abi,
      } = getContractConfig();
      const hash = await walletClient.writeContract({
        address: contractAddress as `0x${string}`,
        abi,
        functionName: "cancelDrop",
        args: [BigInt(dropId)],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      toast.success("Drop cancelled successfully");
      fetchAndSetDropInfo(dropId, false);
    } catch (err: any) {
      const errorMessage =
        err.shortMessage ||
        err.message?.split("(")[0] ||
        "Failed to cancel drop";
      setError(errorMessage);
      toast.error(errorMessage);
      console.error("Error cancelling drop:", err);
    } finally {
      setActionInProgress(false);
    }
  };

  const claimRefund = async () => {
    if (
      isConnecting ||
      isWalletClientLoading ||
      !walletClient ||
      !address ||
      !dropInfo ||
      !dropId
    ) {
      toast.error("Wallet not ready or drop info missing.");
      return;
    }
    if (dropInfo.isActive) {
      toast.error("Drop is still active. Cannot claim refund yet.");
      return;
    }
    if (!dropInfo.isCompleted) {
      toast.error("Drop is not yet marked as completed/cancelled.");
      return;
    }
    if (!dropInfo.isPaidEntry) {
      toast.error("This was not a paid entry drop.");
      return;
    }
    if (
      !participants.some((p) => getAddress(p.address) === getAddress(address))
    ) {
      toast.error("You did not participate in this drop.");
      return;
    }

    setActionInProgress(true);
    setError(null);
    try {
      const {
        publicClient,
        address: contractAddress,
        abi,
      } = getContractConfig();
      const hash = await walletClient.writeContract({
        address: contractAddress as `0x${string}`,
        abi,
        functionName: "claimRefund",
        args: [BigInt(dropId)],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      toast.success("Refund claimed successfully!");
      fetchAndSetDropInfo(dropId, false);
    } catch (err: any) {
      const errorMessage =
        err.shortMessage ||
        err.message?.split("(")[0] ||
        "Failed to claim refund";
      setError(errorMessage);
      toast.error(errorMessage);
      console.error("Error claiming refund:", err);
    } finally {
      setActionInProgress(false);
    }
  };

  const handleShareDrop = async () => {
    if (!dropInfo || !dropId) return;
    const shareText = `Check out Fireball Drop #${dropId}!\nPrize: ${dropInfo.rewardAmount}.\nJoin here:`;
    const shareUrl = `https://fireball-rho.vercel.app/drop/${dropId}`;
    try {
      await sdk.actions.composeCast({ text: shareText, embeds: [shareUrl] });
      console.log(shareText, shareUrl);
    } catch (error) {
      console.error("Failed to compose cast for sharing drop:", error);
      toast.error("Could not open Farcaster composer to share.");
    }
  };

  if (loadingData && !dropInfo) {
    return (
      <div className="min-h-screen bg-gray-900 p-6 flex justify-center items-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-orange-500"></div>
      </div>
    );
  }

  if (error && !dropInfo) {
    return (
      <div className="min-h-screen bg-gray-900 p-6">
        <div className="w-full max-w-4xl mx-auto">
          <div className="bg-gradient-to-br from-red-800 via-orange-700 to-yellow-600 p-8 rounded-2xl shadow-2xl border border-orange-500 text-center">
            <h2 className="text-xl font-bold text-white mb-2">
              Error Loading Drop
            </h2>
            <p className="text-gray-100">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  if (!dropInfo) {
    return (
      <div className="min-h-screen bg-gray-900 p-6">
        <div className="w-full max-w-4xl mx-auto">
          <div className="bg-gradient-to-br from-red-800 via-orange-700 to-yellow-600 p-8 rounded-2xl shadow-2xl border border-orange-500 text-center">
            <h2 className="text-xl font-bold text-white mb-2">
              Drop Not Found
            </h2>
            <p className="text-gray-100">
              This drop may not exist, or it's an unfunded sponsored game.
            </p>
            <button
              onClick={() => navigate("/available")}
              className="mt-4 py-2 px-4 bg-orange-600 hover:bg-orange-700 text-white font-medium rounded-lg transition-colors duration-200 shadow-lg"
            >
              View Available Drops
            </button>
          </div>
        </div>
      </div>
    );
  }

  const isUserHost =
    address && dropInfo.host
      ? getAddress(dropInfo.host) === getAddress(address)
      : false;
  const isUserParticipant =
    address &&
    participants.some((p) => getAddress(p.address) === getAddress(address));
  const uiIsEffectivelyCancelled =
    !dropInfo.isActive && dropInfo.isCompleted && dropInfo.winners.length === 0;

  const hostProfile =
    dropInfo.host && isAddress(dropInfo.host)
      ? fcProfiles[getAddress(dropInfo.host)]
      : undefined;
  const sponsorProfile =
    dropInfo.sponsor &&
    dropInfo.sponsor !== "0x0000000000000000000000000000000000000000" &&
    isAddress(dropInfo.sponsor)
      ? fcProfiles[getAddress(dropInfo.sponsor)]
      : undefined;

  return (
    <div className="min-h-screen bg-gray-900 p-6">
      <div className="w-full max-w-5xl mx-auto relative">
        <div className="text-center mb-8">
          <h1 className="text-4xl sm:text-5xl font-extrabold mb-2">
            <span className="text-red-600">Drop</span>{" "}
            <span className="text-orange-500">#{dropId}</span>
            {dropInfo.isSponsored && (
              <span className="ml-2 bg-yellow-600 text-white text-xs sm:text-sm px-2 py-1 rounded-full whitespace-nowrap">
                Sponsored
              </span>
            )}
          </h1>
          <div className="h-1 w-40 bg-gradient-to-r from-red-600 to-orange-500 rounded-full mx-auto mb-3"></div>
          <p className="text-gray-100 text-sm sm:text-base">
            Join the game or manage your drop
          </p>
        </div>

        <button
          onClick={handleShareDrop}
          className="absolute top-0 right-0 p-2 bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-lg transition-colors duration-200 disabled:opacity-60 disabled:cursor-not-allowed"
          disabled={
            actionInProgress ||
            !dropInfo.isActive ||
            dropInfo.isCompleted ||
            uiIsEffectivelyCancelled
          }
          title="Share this Drop"
        >
          <Share className="h-5 w-5" />
        </button>

        <div className="flex flex-col lg:flex-row gap-6">
          <div className="lg:w-1/3">
            <div className="bg-gradient-to-br from-red-800 via-orange-700 to-yellow-600 p-6 rounded-2xl shadow-2xl border border-orange-500">
              <h2 className="text-2xl font-bold text-white mb-4">
                Drop Details
              </h2>
              <div className="space-y-3 text-gray-100 text-sm">
                <p className="truncate" title={dropInfo.host}>
                  <span className="font-semibold text-gray-300">Host:</span>{" "}
                  {hostProfile ? (
                    <>
                      {hostProfile.pfpUrl && (
                        <img
                          src={hostProfile.pfpUrl}
                          alt={
                            hostProfile.displayName ||
                            hostProfile.username ||
                            ""
                          }
                          className="inline-block w-5 h-5 rounded-full mr-1.5 align-middle"
                          onError={(e) =>
                            (e.currentTarget.style.display = "none")
                          }
                        />
                      )}
                      {hostProfile.displayName ||
                        hostProfile.username ||
                        `${dropInfo.host.slice(0, 6)}...${dropInfo.host.slice(
                          -4
                        )}`}
                    </>
                  ) : (
                    `${dropInfo.host.slice(0, 6)}...${dropInfo.host.slice(-4)}`
                  )}
                </p>
                {dropInfo.isSponsored &&
                  dropInfo.sponsor &&
                  dropInfo.sponsor !==
                    "0x0000000000000000000000000000000000000000" && (
                    <p className="truncate" title={dropInfo.sponsor}>
                      <span className="font-semibold text-gray-300">
                        Sponsor:
                      </span>{" "}
                      {sponsorProfile ? (
                        <>
                          {sponsorProfile.pfpUrl && (
                            <img
                              src={sponsorProfile.pfpUrl}
                              alt={
                                sponsorProfile.displayName ||
                                sponsorProfile.username ||
                                ""
                              }
                              className="inline-block w-5 h-5 rounded-full mr-1.5 align-middle"
                              onError={(e) =>
                                (e.currentTarget.style.display = "none")
                              }
                            />
                          )}
                          {sponsorProfile.displayName ||
                            sponsorProfile.username ||
                            `${dropInfo.sponsor.slice(
                              0,
                              6
                            )}...${dropInfo.sponsor.slice(-4)}`}
                        </>
                      ) : (
                        `${dropInfo.sponsor.slice(
                          0,
                          6
                        )}...${dropInfo.sponsor.slice(-4)}`
                      )}
                    </p>
                  )}
                <p>
                  <span className="font-semibold text-gray-300">
                    Entry Fee:
                  </span>{" "}
                  {dropInfo.entryFee}
                </p>
                <p>
                  <span className="font-semibold text-gray-300">Reward:</span>{" "}
                  <span className="font-bold text-orange-300">
                    {dropInfo.rewardAmount}
                  </span>
                </p>
                {(dropInfo.rewardType === RewardType.ERC20 ||
                  dropInfo.rewardType === RewardType.USDC ||
                  dropInfo.rewardType === RewardType.NFT) &&
                  dropInfo.rewardToken !==
                    "0x0000000000000000000000000000000000000000" && (
                    <p
                      className="text-xs truncate"
                      title={dropInfo.rewardToken}
                    >
                      <span className="font-semibold text-gray-300">
                        Token:
                      </span>{" "}
                      {dropInfo.rewardToken.slice(0, 8)}...
                      {dropInfo.rewardToken.slice(-4)}
                    </p>
                  )}
                {dropInfo.rewardType === RewardType.NFT &&
                  dropInfo.rewardTokenIds.length > 0 && (
                    <p
                      className="text-xs truncate"
                      title={dropInfo.rewardTokenIds.join(", ")}
                    >
                      <span className="font-semibold text-gray-300">
                        NFT IDs:
                      </span>{" "}
                      {dropInfo.rewardTokenIds.join(", ").substring(0, 20)}
                      {dropInfo.rewardTokenIds.join(", ").length > 20
                        ? "..."
                        : ""}
                    </p>
                  )}
                <p>
                  <span className="font-semibold text-gray-300">
                    Participants:
                  </span>{" "}
                  {dropInfo.currentParticipants}/{dropInfo.maxParticipants}
                </p>
                <p>
                  <span className="font-semibold text-gray-300">Status:</span>{" "}
                  {uiIsEffectivelyCancelled ? (
                    <span className="text-yellow-400">Cancelled</span>
                  ) : dropInfo.isCompleted ? (
                    <span className="text-red-400">Ended</span>
                  ) : dropInfo.isActive ? (
                    <span className="text-green-400">Active</span>
                  ) : (
                    <span className="text-gray-500">Inactive</span>
                  )}
                </p>
                {dropInfo.isSponsored &&
                  dropInfo.fundingDeadline > 0 &&
                  !dropInfo.isCompleted && (
                    <p>
                      <span className="font-semibold text-gray-300">
                        Funds By:
                      </span>{" "}
                      {new Date(
                        dropInfo.fundingDeadline * 1000
                      ).toLocaleDateString()}
                    </p>
                  )}
                {dropInfo.isCompleted && dropInfo.winners.length > 0 && (
                  <div>
                    <span className="font-semibold text-gray-300">
                      Winners:
                    </span>{" "}
                    <div className="text-xs space-y-0.5">
                      {dropInfo.winners.map(
                        (winnerAddr: string, idx: number) => {
                          const winnerProfile = isAddress(winnerAddr)
                            ? fcProfiles[getAddress(winnerAddr)]
                            : undefined;
                          return (
                            <div
                              key={idx}
                              className="truncate"
                              title={winnerAddr}
                            >
                              {idx + 1}.{" "}
                              {winnerProfile?.pfpUrl && (
                                <img
                                  src={winnerProfile.pfpUrl}
                                  alt={
                                    winnerProfile.displayName ||
                                    winnerProfile.username ||
                                    ""
                                  }
                                  className="inline-block w-4 h-4 rounded-full mr-1 align-middle"
                                  onError={(e) =>
                                    (e.currentTarget.style.display = "none")
                                  }
                                />
                              )}
                              {winnerProfile?.displayName ||
                                winnerProfile?.username ||
                                `${winnerAddr.slice(0, 6)}...${winnerAddr.slice(
                                  -4
                                )}`}
                            </div>
                          );
                        }
                      )}
                    </div>
                  </div>
                )}
              </div>
              <h3 className="text-xl font-semibold text-white mt-6 mb-3">
                Participants ({participants.length})
              </h3>
              {participants.length === 0 ? (
                <p className="text-gray-200 text-sm">No participants yet.</p>
              ) : (
                <ul className="space-y-1 max-h-40 overflow-y-auto text-xs text-gray-200">
                  {participants.map((participant) => {
                    const participantProfile = isAddress(participant.address)
                      ? fcProfiles[getAddress(participant.address)]
                      : undefined;
                    return (
                      <li
                        key={participant.slot}
                        className="truncate"
                        title={participant.address}
                      >
                        {participant.slot + 1}.{" "}
                        {participantProfile?.pfpUrl && (
                          <img
                            src={participantProfile.pfpUrl}
                            alt={
                              participantProfile.displayName ||
                              participantProfile.username ||
                              ""
                            }
                            className="inline-block w-4 h-4 rounded-full mr-1 align-middle"
                            onError={(e) =>
                              (e.currentTarget.style.display = "none")
                            }
                          />
                        )}
                        {participantProfile?.displayName ||
                          participantProfile?.username ||
                          participant.name}
                      </li>
                    );
                  })}
                </ul>
              )}
              <div className="mt-6 space-y-3">
                {!dropInfo.isCompleted &&
                  dropInfo.isActive &&
                  !uiIsEffectivelyCancelled && (
                    <button
                      onClick={joinDrop}
                      className="w-full py-2.5 px-4 bg-orange-500 hover:bg-orange-600 text-white font-semibold rounded-lg transition-colors duration-200 shadow-lg disabled:opacity-60 disabled:cursor-not-allowed"
                      disabled={
                        actionInProgress ||
                        !isConnected ||
                        !address ||
                        isUserParticipant ||
                        dropInfo.currentParticipants >=
                          dropInfo.maxParticipants ||
                        !dropInfo.isActive ||
                        dropInfo.isCompleted
                      }
                    >
                      {actionInProgress
                        ? "Processing..."
                        : isUserParticipant
                        ? "Already Joined"
                        : dropInfo.currentParticipants >=
                          dropInfo.maxParticipants
                        ? "Drop Full"
                        : "Join Drop"}
                    </button>
                  )}
                {isUserHost &&
                  dropInfo.isActive &&
                  !dropInfo.isCompleted &&
                  !uiIsEffectivelyCancelled && (
                    <button
                      onClick={cancelDrop}
                      className="w-full py-2.5 px-4 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg transition-colors duration-200 shadow-lg disabled:opacity-60 disabled:cursor-not-allowed"
                      disabled={
                        actionInProgress ||
                        dropInfo.isCompleted ||
                        !dropInfo.isActive ||
                        dropInfo.currentParticipants >= dropInfo.maxParticipants
                      }
                    >
                      {actionInProgress ? "Processing..." : "Cancel Drop"}
                    </button>
                  )}
                {isUserParticipant &&
                  uiIsEffectivelyCancelled &&
                  dropInfo.isPaidEntry && (
                    <button
                      onClick={claimRefund}
                      className="w-full py-2.5 px-4 bg-yellow-500 hover:bg-yellow-600 text-gray-900 font-semibold rounded-lg transition-colors duration-200 shadow-lg disabled:opacity-60 disabled:cursor-not-allowed"
                      disabled={actionInProgress}
                    >
                      {actionInProgress ? "Processing..." : "Claim Refund"}
                    </button>
                  )}
              </div>
            </div>
          </div>
          <div className="lg:w-2/3 flex flex-col gap-6">
            <div className="bg-gradient-to-br from-red-800 via-orange-700 to-yellow-600 p-4 sm:p-6 rounded-2xl shadow-2xl border border-orange-500">
              {dropInfo && (
                <PlinkoBoard
                  key={dropId}
                  dropId={dropId as string}
                  ref={plinkoBoardRef}
                  rows={rows}
                  numWinners={dropInfo.numWinners}
                  currentParticipants={dropInfo.currentParticipants}
                  maxParticipants={dropInfo.maxParticipants}
                  dropBall={selectWinnersManually}
                  isHost={isUserHost}
                  isManual={dropInfo.isManualSelection}
                  isActive={dropInfo.isActive}
                  isCompleted={dropInfo.isCompleted}
                  winnerIndices={winnerIndices}
                  animateWinners={animateWinners}
                  setAnimateWinners={setAnimateWinners}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DropDetailPage;
