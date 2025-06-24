import React, { useEffect, useState } from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import "./App.css";
import Navbar from "./components/Navbar";
import CreateDropPage from "./pages/CreateDropPage";
import AvailableDropsPage from "./pages/AvailableDropsPage";
import UpcomingDropsPage from "./pages/UpcomingDropsPage";
import EndedDropsPage from "./pages/EndedDropsPage";
import MyDropsPage from "./pages/MyDropsPage";
import DropDetailPage from "./pages/DropDetailPage";
import IntroPage from "./pages/IntroPage";
import LeaderboardPage from "./pages/LeaderboardPage";
import SponsorGame from "./pages/SponsorGame";
import FooterNav from "./components/FooterNav";
import { sdk } from "@farcaster/frame-sdk";
import { signIn, promptAddFrameAndNotifications, AuthUser } from "./utils/auth";
import { useAccount } from "wagmi";

const App: React.FC = () => {
  const [, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { address: connectedAddress } = useAccount(); // Get connected address

  useEffect(() => {
    const initializeMiniApp = async () => {
      try {
        await sdk.actions.ready();
        // Ensure connectedAddress is available before calling functions that need it
        const userAddressForAuth = connectedAddress || ""; // Fallback to empty string if not connected

        const authUser = await signIn(userAddressForAuth);
        if (authUser) {
          setUser(authUser);
          if (userAddressForAuth) {
            // Only prompt if we have an address
            const result = await promptAddFrameAndNotifications(
              userAddressForAuth
            );
            if (result.added) {
              setUser((prevUser) =>
                prevUser ? { ...prevUser, hasAddedApp: true } : null
              );
            }
          }
        }
      } catch (error) {
        console.error("Error initializing app:", error);
        setError("Failed to initialize app. Please try again.");
      } finally {
        setIsLoading(false);
      }
    };
    initializeMiniApp(); // Run once on mount
  }, [connectedAddress]); // Re-run if connectedAddress changes (though typically it's for initial load)

  if (error) {
    return (
      <div className="flex flex-col min-h-screen bg-slate-900 text-white justify-center items-center">
        {error}
      </div>
    );
  }

  return (
    <Router>
      <div className="flex flex-col min-h-screen bg-slate-900 text-white">
        <Navbar />
        <main className="flex-grow container mx-auto px-4 py-6 md:py-8 pb-20 md:pb-8">
          {isLoading ? (
            <div className="text-center">Loading...</div>
          ) : (
            <Routes>
              <Route path="/" element={<IntroPage />} />
              <Route path="/create" element={<CreateDropPage />} />
              <Route path="/sponsor" element={<SponsorGame />} />
              <Route path="/available" element={<AvailableDropsPage />} />
              <Route path="/upcoming" element={<UpcomingDropsPage />} />
              <Route path="/ended" element={<EndedDropsPage />} />
              <Route path="/my-drops" element={<MyDropsPage />} />
              <Route path="/drop/:dropId" element={<DropDetailPage />} />
              <Route path="/leaderboard" element={<LeaderboardPage />} />
              <Route path="*" element={<div>Page Not Found</div>} />
            </Routes>
          )}
        </main>
        <FooterNav />
      </div>
    </Router>
  );
};

export default App;
