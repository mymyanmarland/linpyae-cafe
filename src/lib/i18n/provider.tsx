"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { dictionaries, type Lang } from "./dictionaries";

const LANG_COOKIE = "cafe_lang";

type LangContextValue = {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
};

const LangContext = createContext<LangContextValue>({
  lang: "my",
  setLang: () => {},
  t: (k) => k,
});

function readInitialLang(): Lang {
  if (typeof document === "undefined") return "my";
  const m = document.cookie.match(/(?:^|; )cafe_lang=(my|en)/);
  if (m) return m[1] as Lang;
  return "my"; // Myanmar-first default
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readInitialLang);

  useEffect(() => {
    document.documentElement.lang = lang === "my" ? "my" : "en";
  }, [lang]);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    document.cookie = `${LANG_COOKIE}=${l}; path=/; max-age=31536000; SameSite=Lax`;
    try {
      localStorage.setItem(LANG_COOKIE, l);
    } catch {}
  }, []);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => {
      const dict = dictionaries[lang] ?? {};
      let s: string = dict[key] ?? dictionaries.en[key] ?? key;
      if (vars) {
        for (const [k, v] of Object.entries(vars)) {
          s = s.replaceAll(`{${k}}`, String(v));
        }
      }
      return s;
    },
    [lang]
  );

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export function useLang(): LangContextValue {
  return useContext(LangContext);
}

/** Pick the right display name for the current language. */
export function useDisplayName() {
  const { lang } = useLang();
  return useCallback(
    (en: string | null | undefined, my: string | null | undefined) => {
      if (lang === "my") return my || en || "";
      return en || my || "";
    },
    [lang]
  );
}
