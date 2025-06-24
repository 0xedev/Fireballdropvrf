import { toast } from "react-toastify";

export interface NotificationPayload {
  fid: number;
  title: string;
  body: string;
  targetUrl: string;
  imageUrl?: string;
  // clientNotificationToken and clientNotificationUrl are no longer needed from frontend
  // as the backend will fetch them from KV store based on FID.
  notificationId?: string;
}

export async function requestAppNotification(
  payload: NotificationPayload
): Promise<void> {
  console.log(
    `[App Notification Service] Requesting to send notification for FID ${payload.fid} via backend:`,
    {
      title: payload.title,
      body: payload.body,
      targetUrl: payload.targetUrl,
      notificationId: payload.notificationId,
    }
  );

  const backendApiUrl = "/api/send-fireball-notification";

  try {
    const response = await fetch(backendApiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    // Attempt to parse response body regardless of status, as backend might send JSON errors
    let responseBody;
    try {
      responseBody = await response.json();
    } catch (e) {
      // If JSON parsing fails, maybe it's plain text or empty
      responseBody = {
        message: (await response.text()) || response.statusText,
      };
    }

    if (!response.ok) {
      const errorMessage = `Failed to send notification to FID ${
        payload.fid
      } via backend. Status: ${response.status}. Details: ${
        responseBody.message || JSON.stringify(responseBody)
      }`;
      console.error("[App Notification Service]", errorMessage, responseBody);

      // Show a toast for backend errors
      toast.error(
        `Notification failed for FID ${payload.fid}. Status: ${response.status}`
      );
      return; // Don't proceed if backend call failed
    }

    // If response is OK (status 200-299)
    console.log(
      "[App Notification Service] Backend response to notification request:",
      JSON.stringify(responseBody, null, 2) // Log the full object stringified
    );
    // Optionally show a success toast, but might be too noisy
    // toast.success(`Notification request sent for FID ${payload.fid}`);
  } catch (error) {
    console.error(
      "[App Notification Service] Client-side error making request to backend:",
      error
    );
    // Show a toast for network/client-side errors
    toast.error(`Failed to send notification request for FID ${payload.fid}.`);
  }
}
