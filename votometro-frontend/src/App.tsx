import { MsalProvider } from "@azure/msal-react";
import type { IPublicClientApplication } from "@azure/msal-browser";
import { AppRouter } from "./router/AppRouter";
import { SessionProvider } from "./context/SessionContext";

import "./index.css";

type AppProps = {
  pca: IPublicClientApplication;
};

function App({ pca }: AppProps) {
  return (
    <MsalProvider instance={pca}>
      <SessionProvider>
        <AppRouter />
      </SessionProvider>
    </MsalProvider>
  );
}

export default App;
