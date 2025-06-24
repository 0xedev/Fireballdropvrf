import React, { useState } from "react";
import { sdk } from "@farcaster/frame-sdk";

interface OnboardingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAppAdded: () => void; // Callback for when the app is successfully added
}

const OnboardingModal: React.FC<OnboardingModalProps> = ({
  isOpen,
  onClose,
  onAppAdded,
}) => {
  const [isAdding, setIsAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAddApp = async () => {
    setIsAdding(true);
    setError(null);
    try {
      console.log("Attempting to add frame via modal...");
      const result = await sdk.actions.addFrame();

      // Check if the result indicates success
      if (result && "success" in result && result.success) {
        console.log("Frame added successfully by the user via modal!");
        onAppAdded();
        onClose();
      } else if (result && "error" in result) {
        // Handle cases where the SDK returns an error object
        const errorMessage =
          result.error instanceof Error
            ? result.error.message
            : String(result.error);
        console.error("Error adding frame from SDK:", errorMessage, result);
        setError(`Failed to add the app: ${errorMessage}`);
      } else {
        // Handle other cases (e.g., success is false, or unexpected result structure)
        // This could include user cancellation if success: false is returned for that.
        console.log("User cancelled or action did not succeed.", result);
        setError(
          "The app was not added. You might have cancelled, or you can try again."
        );
      }
    } catch (err) {
      console.error("Error adding frame via modal:", err);
      setError("An unexpected error occurred. Please try again.");
    } finally {
      setIsAdding(false);
    }
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4 transition-opacity duration-300 ease-in-out">
      <div className="bg-gray-800 p-6 md:p-8 rounded-lg shadow-xl max-w-md w-full text-white transform transition-all duration-300 ease-in-out scale-100">
        <h2 className="text-2xl font-bold mb-4 text-orange-400">
          Pin FireBall App!
        </h2>
        <p className="mb-6 text-gray-300">
          Add FireBall to your Farcaster apps for quick access and to stay
          updated. It's like pinning your favorite app!
        </p>

        {error && <p className="mb-4 text-red-400 text-sm">{error}</p>}

        <div className="flex flex-col sm:flex-row justify-end space-y-3 sm:space-y-0 sm:space-x-3">
          <button
            onClick={onClose}
            disabled={isAdding}
            className="px-4 py-2 rounded-md text-sm font-medium bg-gray-600 hover:bg-gray-500 transition-colors duration-200 disabled:opacity-50"
          >
            Maybe Later
          </button>
          <button
            onClick={handleAddApp}
            disabled={isAdding}
            className="px-4 py-2 rounded-md text-sm font-medium bg-orange-500 hover:bg-orange-600 transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isAdding ? "Adding..." : "Add to Farcaster"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default OnboardingModal;
