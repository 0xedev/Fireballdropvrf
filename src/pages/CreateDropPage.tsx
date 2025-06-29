import React, { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAccount, useWalletClient } from "wagmi";
import {
  parseEther,
  parseUnits,
  getAddress,
  isAddress,
  decodeEventLog,
} from "viem";
import { toast } from "react-toastify";
import { getContractConfig } from "../utils/contract";
import { RewardType } from "../types/global";
import { ERC20_MINIMAL_ABI, ERC721_MINIMAL_ABI } from "../utils/erc20";

const USDC_BASE_ADDRESS =
  "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as `0x${string}`;

// Helper function to get token decimals
async function getTokenDecimals(tokenAddress: `0x${string}`): Promise<number> {
  if (tokenAddress === "0x0000000000000000000000000000000000000000") return 18;
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
      `Could not fetch decimals for ${tokenAddress}, defaulting to 18.`
    );
    return 18;
  }
}

// Helper to get token info
async function getTokenInfo(
  tokenAddress: `0x${string}`,
  isNFT: boolean
): Promise<{ decimals: number; name: string; symbol: string }> {
  if (
    !isAddress(tokenAddress) ||
    tokenAddress === "0x0000000000000000000000000000000000000000"
  ) {
    return {
      decimals: 18,
      name: isNFT ? "NFT" : "Token",
      symbol: isNFT ? "NFT" : "TKN",
    };
  }
  const { publicClient } = getContractConfig();
  const abiToUse = isNFT ? ERC721_MINIMAL_ABI : ERC20_MINIMAL_ABI;

  try {
    const [name, symbol, decimals] = await Promise.all([
      publicClient.readContract({
        address: tokenAddress,
        abi: abiToUse,
        functionName: "name",
      }) as Promise<string>,
      publicClient.readContract({
        address: tokenAddress,
        abi: abiToUse,
        functionName: "symbol",
      }) as Promise<string>,
      isNFT
        ? Promise.resolve(18)
        : (publicClient.readContract({
            address: tokenAddress,
            abi: ERC20_MINIMAL_ABI,
            functionName: "decimals",
          }) as Promise<number>),
    ]);
    return { decimals: Number(decimals), name, symbol };
  } catch (e) {
    console.warn(`Could not fetch info for ${tokenAddress}: ${e}`);
    const shortAddress =
      tokenAddress.slice(0, 6) + "..." + tokenAddress.slice(-4);
    return {
      decimals: 18,
      name: isNFT ? `NFT (${shortAddress})` : `Token (${shortAddress})`,
      symbol: shortAddress.slice(0, 5),
    };
  }
}

const CreateDropPage: React.FC = () => {
  const { address, isConnected, isConnecting } = useAccount();
  const { data: walletClient, isLoading: isWalletClientLoading } =
    useWalletClient();
  const navigate = useNavigate();

  const [fundingType, setFundingType] = useState<
    "host-funded" | "participant-paid"
  >("participant-paid");
  const [isSponsoredGame, setIsSponsoredGame] = useState<boolean>(false);
  const [selectedRewardType, setSelectedRewardType] = useState<RewardType>(
    RewardType.ETH
  );

  const [entryFeeString, setEntryFeeString] = useState<string>("");
  const [rewardAmountString, setRewardAmountString] = useState<string>("");

  const [rewardTokenAddress, setRewardTokenAddress] = useState<string>("");
  const [rewardTokenIdsString, setRewardTokenIdsString] = useState<string>("");
  const [fetchedTokenName, setFetchedTokenName] = useState<string>("");
  const [fetchedTokenSymbol, setFetchedTokenSymbol] = useState<string>("");
  const [isFetchingTokenInfo, setIsFetchingTokenInfo] =
    useState<boolean>(false);

  const [maxParticipants, setMaxParticipants] = useState<string>("10");
  const [numWinners, setNumWinners] = useState<number>(1);
  const [selectionType, setSelectionType] = useState<"manual" | "automatic">(
    "manual"
  );

  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const MAX_PARTICIPANTS_LIMIT = 100;
  const MAX_WINNERS_LIMIT = 3;

  // Effect to handle RewardType changes
  useEffect(() => {
    setEntryFeeString("");
    setRewardAmountString("");
    setFetchedTokenName("");
    setFetchedTokenSymbol("");

    if (selectedRewardType === RewardType.USDC) {
      setRewardTokenAddress(USDC_BASE_ADDRESS);
    } else if (selectedRewardType === RewardType.ETH) {
      setRewardTokenAddress("");
    } else {
      if (rewardTokenAddress === USDC_BASE_ADDRESS) {
        setRewardTokenAddress("");
      }
    }

    if (selectedRewardType !== RewardType.NFT) {
      setRewardTokenIdsString("");
    }

    if (selectedRewardType === RewardType.NFT) {
      setFundingType("host-funded");
      setIsSponsoredGame(false);
      setEntryFeeString("0");
    }
  }, [selectedRewardType]);

  // Effect to handle FundingType changes
  useEffect(() => {
    if (fundingType === "participant-paid") {
      setIsSponsoredGame(false);
      if (selectedRewardType === RewardType.NFT) {
        setSelectedRewardType(RewardType.ETH);
      }
    }
  }, [fundingType, selectedRewardType]);

  // Effect to fetch token info
  useEffect(() => {
    const fetchInfo = async () => {
      setFetchedTokenName("");
      setFetchedTokenSymbol("");

      if (selectedRewardType === RewardType.USDC) {
        setFetchedTokenName("USD Coin");
        setFetchedTokenSymbol("USDC");
        setIsFetchingTokenInfo(false);
        return;
      }

      const isNFTType = selectedRewardType === RewardType.NFT;
      if (
        (selectedRewardType === RewardType.ERC20 || isNFTType) &&
        isAddress(rewardTokenAddress)
      ) {
        setIsFetchingTokenInfo(true);
        try {
          const info = await getTokenInfo(
            rewardTokenAddress as `0x${string}`,
            isNFTType
          );
          setFetchedTokenName(info.name);
          setFetchedTokenSymbol(info.symbol);
        } catch (e) {
          console.error("Failed to fetch token info:", e);
          setFetchedTokenName("Error fetching name");
        } finally {
          setIsFetchingTokenInfo(false);
        }
      }
    };

    const debounceTimer = setTimeout(() => {
      if (rewardTokenAddress && rewardTokenAddress !== USDC_BASE_ADDRESS) {
        fetchInfo();
      } else if (!rewardTokenAddress) {
        setFetchedTokenName("");
        setFetchedTokenSymbol("");
      }
    }, 500);

    return () => clearTimeout(debounceTimer);
  }, [rewardTokenAddress, selectedRewardType]);

  // Auto-calculate rewardAmount for participant-paid drops
  useEffect(() => {
    if (
      fundingType === "participant-paid" &&
      selectedRewardType !== RewardType.NFT
    ) {
      const fee = parseFloat(entryFeeString);
      const participants = parseInt(maxParticipants) || 0;
      if (!isNaN(fee) && fee > 0 && participants > 0) {
        setRewardAmountString(
          (fee * participants).toFixed(10).replace(/\.?0+$/, "")
        );
      } else {
        setRewardAmountString("");
      }
    }
  }, [entryFeeString, maxParticipants, fundingType, selectedRewardType]);

  const validateInputs = useCallback((): boolean => {
    setErrorMessage(null);
    const participants = parseInt(maxParticipants);

    if (
      isNaN(participants) ||
      participants <= 0 ||
      participants > MAX_PARTICIPANTS_LIMIT
    ) {
      setErrorMessage(
        `Max participants must be between 1 and ${MAX_PARTICIPANTS_LIMIT}.`
      );
      return false;
    }
    const currentNumWinners = Number(numWinners);
    if (
      currentNumWinners <= 0 ||
      currentNumWinners > MAX_WINNERS_LIMIT ||
      currentNumWinners >= participants
    ) {
      setErrorMessage(
        `Number of winners must be between 1 and ${Math.min(
          participants - 1,
          MAX_WINNERS_LIMIT
        )}.`
      );
      return false;
    }

    const isActuallyPaidEntry = fundingType === "participant-paid";

    if (selectedRewardType === RewardType.NFT) {
      if (isActuallyPaidEntry) {
        setErrorMessage("NFT drops must be Host-Funded.");
        return false;
      }
      if (!rewardTokenAddress || !isAddress(rewardTokenAddress)) {
        setErrorMessage("Valid NFT Contract Address required.");
        return false;
      }
      const tokenIds = rewardTokenIdsString
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean);
      if (tokenIds.length !== currentNumWinners) {
        setErrorMessage(
          `Provide exactly ${currentNumWinners} NFT Token ID(s).`
        );
        return false;
      }
      if (tokenIds.some((id) => isNaN(parseInt(id)) || parseInt(id) < 0)) {
        setErrorMessage("NFT Token IDs must be valid non-negative numbers.");
        return false;
      }
    } else if (selectedRewardType === RewardType.USDC) {
      if (getAddress(rewardTokenAddress) !== getAddress(USDC_BASE_ADDRESS)) {
        setErrorMessage("USDC token address is fixed.");
        return false;
      }
      if (isActuallyPaidEntry) {
        if (!entryFeeString || parseFloat(entryFeeString) <= 0) {
          setErrorMessage("Entry fee (USDC) must be > 0.");
          return false;
        }
      } else {
        if (!rewardAmountString || parseFloat(rewardAmountString) <= 0) {
          setErrorMessage("Reward amount (USDC) must be > 0.");
          return false;
        }
      }
    } else if (selectedRewardType === RewardType.ERC20) {
      if (!rewardTokenAddress || !isAddress(rewardTokenAddress)) {
        setErrorMessage("Valid Token Contract Address required.");
        return false;
      }
      if (isActuallyPaidEntry) {
        if (!entryFeeString || parseFloat(entryFeeString) <= 0) {
          setErrorMessage("Entry fee (tokens) must be > 0.");
          return false;
        }
      } else {
        if (!rewardAmountString || parseFloat(rewardAmountString) <= 0) {
          setErrorMessage("Reward amount (tokens) must be > 0.");
          return false;
        }
      }
    } else if (selectedRewardType === RewardType.ETH) {
      if (isActuallyPaidEntry) {
        if (!entryFeeString || parseFloat(entryFeeString) <= 0) {
          setErrorMessage("Entry fee (ETH) must be > 0.");
          return false;
        }
      } else {
        if (!rewardAmountString || parseFloat(rewardAmountString) <= 0) {
          setErrorMessage("Reward amount (ETH) must be > 0.");
          return false;
        }
      }
    }
    if (isActuallyPaidEntry && selectedRewardType !== RewardType.NFT) {
      const fee = parseFloat(entryFeeString);
      const calculatedReward = parseFloat((fee * participants).toFixed(10));
      if (
        !rewardAmountString ||
        Math.abs(parseFloat(rewardAmountString) - calculatedReward) > 1e-9 ||
        parseFloat(rewardAmountString) <= 0
      ) {
        setErrorMessage(
          "Reward amount must match Entry Fee * Max Participants."
        );
        return false;
      }
    }
    return true;
  }, [
    maxParticipants,
    numWinners,
    selectedRewardType,
    fundingType,
    entryFeeString,
    rewardAmountString,
    rewardTokenAddress,
    rewardTokenIdsString,
  ]);

  const handleSubmit = async () => {
    if (!isConnected || !walletClient || !address) {
      toast.error("Please connect your wallet.");
      return;
    }
    if (!validateInputs()) {
      toast.error(errorMessage || "Form errors detected.");
      return;
    }
    setIsSubmitting(true);

    try {
      const {
        publicClient,
        address: contractAddress,
        abi,
      } = getContractConfig();
      const isActuallyPaidEntry = fundingType === "participant-paid";
      const isManual = selectionType === "manual";
      const participantsCount = BigInt(parseInt(maxParticipants));
      const actualNumWinners = Number(numWinners);

      let effectiveRewardTokenAddr: `0x${string}` =
        "0x0000000000000000000000000000000000000000";
      let finalRewardTokenIds: bigint[] = [];
      let finalEntryFeeBigInt: bigint = 0n;
      let finalRewardAmountBigInt: bigint = 0n;
      let ethValueToSend: bigint = 0n;

      if (selectedRewardType === RewardType.USDC) {
        effectiveRewardTokenAddr = USDC_BASE_ADDRESS;
      } else if (
        selectedRewardType === RewardType.ERC20 ||
        selectedRewardType === RewardType.NFT
      ) {
        effectiveRewardTokenAddr = getAddress(rewardTokenAddress);
      }

      if (selectedRewardType === RewardType.ETH) {
        finalEntryFeeBigInt = isActuallyPaidEntry
          ? parseEther(entryFeeString)
          : 0n;
        finalRewardAmountBigInt = parseEther(rewardAmountString);
        if (fundingType === "host-funded" && !isSponsoredGame) {
          ethValueToSend = finalRewardAmountBigInt;
        }
      } else if (
        selectedRewardType === RewardType.USDC ||
        selectedRewardType === RewardType.ERC20
      ) {
        const decimals = await getTokenDecimals(effectiveRewardTokenAddr);
        finalEntryFeeBigInt = isActuallyPaidEntry
          ? parseUnits(entryFeeString, decimals)
          : 0n;
        finalRewardAmountBigInt = parseUnits(rewardAmountString, decimals);
        if (fundingType === "host-funded" && !isSponsoredGame) {
          toast.info(
            `Approving ${rewardAmountString} ${
              fetchedTokenSymbol || "tokens"
            }...`
          );
          const approveHash = await walletClient.writeContract({
            address: effectiveRewardTokenAddr,
            abi: ERC20_MINIMAL_ABI,
            functionName: "approve",
            args: [contractAddress, finalRewardAmountBigInt],
          });
          await publicClient.waitForTransactionReceipt({ hash: approveHash });
          toast.success("Token approval successful!");
        }
      } else if (selectedRewardType === RewardType.NFT) {
        finalRewardTokenIds = rewardTokenIdsString
          .split(",")
          .map((id) => BigInt(id.trim()));
        finalRewardAmountBigInt = 0n;
        if (fundingType === "host-funded" && !isSponsoredGame) {
          for (const tokenId of finalRewardTokenIds) {
            toast.info(`Approving NFT ID: ${tokenId}...`);
            const approveNftHash = await walletClient.writeContract({
              address: effectiveRewardTokenAddr,
              abi: ERC721_MINIMAL_ABI,
              functionName: "approve",
              args: [contractAddress, tokenId],
            });
            await publicClient.waitForTransactionReceipt({
              hash: approveNftHash,
            });
            toast.success(`NFT ID: ${tokenId} approved!`);
          }
        }
      }

      let txHash: `0x${string}`;
      const callIsSponsored = fundingType === "host-funded" && isSponsoredGame;

      if (callIsSponsored) {
        toast.info("Creating sponsored game...");
        txHash = await walletClient.writeContract({
          address: contractAddress,
          abi,
          functionName: "sponsorGame",
          args: [
            finalRewardAmountBigInt,
            effectiveRewardTokenAddr,
            selectedRewardType,
            finalRewardTokenIds,
            participantsCount,
            isManual,
            actualNumWinners,
          ],
          value: 0n,
        });
      } else {
        toast.info("Creating drop...");
        txHash = await walletClient.writeContract({
          address: contractAddress,
          abi,
          functionName: "createDrop",
          args: [
            finalEntryFeeBigInt,
            finalRewardAmountBigInt,
            effectiveRewardTokenAddr,
            selectedRewardType,
            finalRewardTokenIds,
            participantsCount,
            isActuallyPaidEntry,
            isManual,
            actualNumWinners,
          ],
          value: ethValueToSend,
        });
      }

      const receipt = await publicClient.waitForTransactionReceipt({
        hash: txHash,
      });

      // Parse dropId from DropCreated event
      let dropId: string = "0"; // Fallback
      try {
        for (const log of receipt.logs) {
          if (log.address.toLowerCase() !== contractAddress.toLowerCase())
            continue;
          try {
            const decodedEvent = decodeEventLog({
              abi,
              data: log.data,
              topics: log.topics,
            });
            if (
              decodedEvent.eventName === "DropCreated" &&
              decodedEvent.args &&
              typeof (decodedEvent.args as any).dropId === "bigint"
            ) {
              dropId = (decodedEvent.args as any).dropId.toString();
              console.log(`[CreateDrop] Parsed dropId: ${dropId}`);
              break;
            }
          } catch (e) {
            console.warn(`[CreateDrop] Could not decode log: ${e}`);
          }
        }
        if (dropId === "0") {
          console.warn("[CreateDrop] No DropCreated event found in logs");
        }
      } catch (e) {
        console.error(`[CreateDrop] Error parsing dropId: ${e}`);
      }

      // Send game-created notification
      try {
        const notificationPayload = {
          category: callIsSponsored ? "game-sponsored" : "game-created",
          dropId,
          hostAddress: address,
          rewardAmount: rewardAmountString,
          tokenSymbol:
            fetchedTokenSymbol ||
            (selectedRewardType === RewardType.ETH ? "ETH" : "Unknown"),
          maxParticipants: parseInt(maxParticipants),
          numWinners: actualNumWinners,
          entryFee: entryFeeString || "0",
          transactionHash: txHash,
        };

        const response = await fetch("/api/send-notification", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(notificationPayload),
        });

        if (!response.ok) {
          const errorData = await response.json();
          console.error(
            `[CreateDrop] Failed to send notification: ${errorData.message}`
          );
          toast.warn(`Notification failed: ${errorData.message}`);
        } else {
          const result = await response.json();
          if (!result.success) {
            toast.warn(`Notification failed: ${result.message}`);
          }
        }
      } catch (notificationError) {
        console.error(
          `[CreateDrop] Error sending notification: ${notificationError}`
        );
        toast.warn("Failed to send notification");
      }

      toast.success(`Drop created! Tx: ${txHash.slice(0, 10)}...`);
      navigate("/available");
    } catch (error: any) {
      console.error(`[CreateDrop] Error creating drop: ${error}`);
      const message =
        error.shortMessage || error.message?.split("(")[0] || "Unknown error.";
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const generateWinnerOptions = () => {
    const options = [];
    const currentMaxParticipants = parseInt(maxParticipants);
    if (isNaN(currentMaxParticipants) || currentMaxParticipants <= 1) {
      return [
        <option key={1} value={1}>
          1 Winner
        </option>,
      ];
    }
    const maxPossibleWinners = Math.max(1, currentMaxParticipants - 1);
    const limit = Math.min(maxPossibleWinners, MAX_WINNERS_LIMIT);

    for (let i = 1; i <= limit; i++) {
      options.push(
        <option key={i} value={i}>
          {i} Winner{i === 1 ? "" : "s"}
        </option>
      );
    }
    return options;
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-900 p-6">
      <div className="w-full max-w-2xl">
        <div className="text-center mb-8">
          <h1 className="text-4xl md:text-5xl font-extrabold mb-2">
            <span className="text-red-600">Create</span>{" "}
            <span className="text-orange-500">Drop</span>
          </h1>
          <div className="h-1 w-40 bg-gradient-to-r from-red-600 to-orange-500 rounded-full mx-auto mb-3"></div>
          <p className="text-gray-100 text-center text-sm md:text-base">
            Configure your giveaway parameters.
          </p>
        </div>

        <div className="bg-gradient-to-br from-red-800 via-orange-700 to-yellow-600 p-6 md:p-8 rounded-2xl shadow-2xl border border-orange-500">
          <div className="mx-auto max-w-md space-y-6">
            {/* Funding Type */}
            <div>
              <label className="input-label">Funding Type</label>
              <select
                value={fundingType}
                onChange={(e) => {
                  const newFundingType = e.target.value as
                    | "host-funded"
                    | "participant-paid";
                  setFundingType(newFundingType);
                }}
                className="input-style text-center"
              >
                <option value="participant-paid">Participant-Paid Entry</option>
                <option value="host-funded">
                  Host-Funded (Direct or Sponsored)
                </option>
              </select>
            </div>

            {fundingType === "host-funded" && (
              <div className="flex items-center justify-center space-x-2 bg-gray-800 bg-opacity-50 p-3 rounded-lg">
                <input
                  type="checkbox"
                  id="isSponsoredGame"
                  checked={isSponsoredGame}
                  onChange={(e) => setIsSponsoredGame(e.target.checked)}
                  className="h-4 w-4 text-orange-500 border-gray-600 rounded focus:ring-orange-400 accent-orange-500"
                />
                <label
                  htmlFor="isSponsoredGame"
                  className="text-sm font-medium text-gray-200"
                >
                  Make this a Sponsored Game? (Opens for sponsor funding)
                </label>
              </div>
            )}

            {/* Reward Type */}
            <div>
              <label className="input-label">Reward Type</label>
              <select
                value={selectedRewardType}
                onChange={(e) => {
                  const newRewardType = parseInt(e.target.value) as RewardType;
                  setSelectedRewardType(newRewardType);
                }}
                className="input-style text-center"
                disabled={
                  fundingType === "participant-paid" &&
                  selectedRewardType === RewardType.NFT
                }
              >
                <option value={RewardType.ETH}>ETH</option>
                <option value={RewardType.USDC}>USDC</option>
                <option value={RewardType.ERC20}>Other ERC20 Token</option>
                <option value={RewardType.NFT}>NFT</option>
              </select>
            </div>

            {/* Token Contract Address Input */}
            {(selectedRewardType === RewardType.ERC20 ||
              selectedRewardType === RewardType.NFT) && (
              <div>
                <label htmlFor="rewardTokenAddress" className="input-label">
                  {selectedRewardType === RewardType.NFT ? "NFT" : "Token"}{" "}
                  Contract Address
                </label>
                <input
                  id="rewardTokenAddress"
                  type="text"
                  value={rewardTokenAddress}
                  onChange={(e) => setRewardTokenAddress(e.target.value)}
                  placeholder="0x..."
                  className="input-style"
                />
                {isFetchingTokenInfo && (
                  <p className="input-description">Fetching token info...</p>
                )}
                {fetchedTokenName && rewardTokenAddress && (
                  <p className="input-description">
                    Name: {fetchedTokenName}{" "}
                    {fetchedTokenSymbol && `(${fetchedTokenSymbol})`}
                  </p>
                )}
              </div>
            )}

            {selectedRewardType === RewardType.USDC && (
              <div className="text-center">
                <p className="input-description">USDC</p>
              </div>
            )}

            {selectedRewardType === RewardType.NFT && (
              <div>
                <label htmlFor="rewardTokenIdsString" className="input-label">
                  NFT Token IDs (comma-separated)
                </label>
                <input
                  id="rewardTokenIdsString"
                  type="text"
                  value={rewardTokenIdsString}
                  onChange={(e) => setRewardTokenIdsString(e.target.value)}
                  placeholder="e.g., 1, 2, 3"
                  className="input-style"
                />
                <p className="input-description">
                  One ID per winner. Must match Number of Winners.
                </p>
              </div>
            )}

            {fundingType === "participant-paid" &&
              selectedRewardType !== RewardType.NFT && (
                <div>
                  <label htmlFor="entryFeeString" className="input-label">
                    Entry Fee (
                    {selectedRewardType === RewardType.ETH
                      ? "ETH"
                      : fetchedTokenSymbol ||
                        (selectedRewardType === RewardType.USDC
                          ? "USDC"
                          : "Tokens")}
                    )
                  </label>
                  <input
                    id="entryFeeString"
                    type="number"
                    value={entryFeeString}
                    onChange={(e) => setEntryFeeString(e.target.value)}
                    step="any"
                    min="0.000000000000000001"
                    placeholder="e.g., 0.01"
                    className="input-style"
                  />
                </div>
              )}

            {selectedRewardType !== RewardType.NFT && (
              <div>
                <label htmlFor="rewardAmountString" className="input-label">
                  Reward Amount (
                  {selectedRewardType === RewardType.ETH
                    ? "ETH"
                    : fetchedTokenSymbol ||
                      (selectedRewardType === RewardType.USDC
                        ? "USDC"
                        : "Tokens")}
                  )
                </label>
                <input
                  id="rewardAmountString"
                  type="number"
                  value={rewardAmountString}
                  onChange={(e) => {
                    if (fundingType === "host-funded") {
                      setRewardAmountString(e.target.value);
                    }
                  }}
                  readOnly={fundingType === "participant-paid"}
                  step="any"
                  min="0.000000000000000001"
                  placeholder={
                    fundingType === "host-funded"
                      ? "e.g., 0.1"
                      : "Auto-calculated"
                  }
                  className={`input-style ${
                    fundingType === "participant-paid"
                      ? "bg-gray-700 cursor-not-allowed"
                      : ""
                  }`}
                />
                {fundingType === "participant-paid" && (
                  <p className="input-description">
                    Auto-calculated: Entry Fee * Max Participants.
                  </p>
                )}
                {fundingType === "host-funded" && isSponsoredGame && (
                  <p className="input-description">
                    Target amount for sponsor funding.
                  </p>
                )}
              </div>
            )}

            <div>
              <label htmlFor="maxParticipants" className="input-label">
                Max Participants
              </label>
              <input
                id="maxParticipants"
                type="number"
                value={maxParticipants}
                onChange={(e) => {
                  const val = e.target.value;
                  setMaxParticipants(val);
                  const currentNumWinners = Number(numWinners);
                  const newMaxParticipants = parseInt(val) || 0;
                  if (
                    newMaxParticipants > 0 &&
                    currentNumWinners >= newMaxParticipants
                  ) {
                    setNumWinners(Math.max(1, newMaxParticipants - 1));
                  } else if (newMaxParticipants <= 1 && currentNumWinners > 0) {
                    setNumWinners(1);
                  }
                }}
                step="1"
                min="1"
                max={MAX_PARTICIPANTS_LIMIT}
                placeholder={`1-${MAX_PARTICIPANTS_LIMIT}`}
                className="input-style"
              />
            </div>

            <div>
              <label htmlFor="numWinners" className="input-label">
                Number of Winners
              </label>
              <select
                id="numWinners"
                value={numWinners}
                onChange={(e) => setNumWinners(parseInt(e.target.value))}
                className="input-style text-center"
                disabled={(parseInt(maxParticipants) || 0) < 2}
              >
                {generateWinnerOptions()}
              </select>
              <p className="input-description">
                Must be less than Max Participants.
              </p>
            </div>

            <div>
              <label className="input-label">Winner Selection</label>
              <select
                value={selectionType}
                onChange={(e) =>
                  setSelectionType(e.target.value as "manual" | "automatic")
                }
                className="input-style text-center"
              >
                <option value="manual">Manual (Host triggers VRF)</option>
                <option value="automatic">Automatic (When full)</option>
              </select>
            </div>

            {errorMessage && (
              <div
                className="mt-4 text-center text-red-300 bg-red-900 bg-opacity-50 p-2 rounded-md text-sm"
                role="alert"
              >
                {errorMessage}
              </div>
            )}

            <div className="mt-8 flex justify-center">
              <button
                onClick={handleSubmit}
                disabled={
                  isSubmitting ||
                  !isConnected ||
                  isConnecting ||
                  isWalletClientLoading
                }
                className="py-2.5 px-6 bg-orange-600 hover:bg-orange-700 text-white font-semibold rounded-lg transition-colors duration-200 shadow-lg w-full md:w-auto text-base disabled:opacity-70 disabled:cursor-not-allowed"
              >
                {isSubmitting ? "Creating..." : "Create Drop"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CreateDropPage;
