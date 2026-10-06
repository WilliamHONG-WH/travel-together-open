import * as React from "react";

const MOBILE_BREAKPOINT = 768;

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined);

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    };
    mql.addEventListener("change", onChange);
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return !!isMobile;
}

/**
 * 护照本布局模式判断：
 * - 单页视图 (singlePage): 仅当移动端竖屏 (portrait 且 width < 768px)
 * - 双页展开视图 (spread): 桌面/大屏 (>=768px) 或移动端横屏 (landscape)
 */
export function usePassportLayout() {
  const [isSinglePage, setIsSinglePage] = React.useState<boolean | undefined>(undefined);

  React.useEffect(() => {
    const widthMql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const orientMql = window.matchMedia("(orientation: landscape)");

    const onChange = () => {
      const narrow = window.innerWidth < MOBILE_BREAKPOINT;
      const portrait = !orientMql.matches;
      setIsSinglePage(narrow && portrait);
    };

    widthMql.addEventListener("change", onChange);
    orientMql.addEventListener("change", onChange);
    onChange();
    return () => {
      widthMql.removeEventListener("change", onChange);
      orientMql.removeEventListener("change", onChange);
    };
  }, []);

  return !!isSinglePage;
}
