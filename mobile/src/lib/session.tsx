import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import { getServer, type Character } from "./api";
import type { Box } from "./placement";

/** What the user has picked so far for the moment being made, shared across screens. */
type Session = {
  server: string | null;
  setServer: (url: string) => void;
  character: Character | null;
  /** A photo from the device used as the character instead of a server character. */
  photoUri: string | null;
  chooseCharacter: (c: Character) => void;
  choosePhoto: (uri: string) => void;
  clipUri: string | null;
  /** Where the stand-in was on screen while filming, and the screen's aspect ratio (width / height). */
  standIn: { box: Box; screenAspect: number } | null;
  setTake: (clipUri: string, standIn: { box: Box; screenAspect: number }) => void;
};

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [server, setServer] = useState<string | null>(null);
  const [character, setCharacter] = useState<Character | null>(null);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [clipUri, setClipUri] = useState<string | null>(null);
  const [standIn, setStandIn] = useState<{ box: Box; screenAspect: number } | null>(null);

  useEffect(() => {
    getServer().then(setServer);
  }, []);

  return (
    <SessionContext.Provider
      value={{
        server,
        setServer,
        character,
        photoUri,
        chooseCharacter: (c) => {
          setCharacter(c);
          setPhotoUri(null);
        },
        choosePhoto: (uri) => {
          setPhotoUri(uri);
          setCharacter(null);
        },
        clipUri,
        standIn,
        setTake: (uri, filmed) => {
          setClipUri(uri);
          setStandIn(filmed);
        },
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession must be used inside SessionProvider");
  return session;
}
