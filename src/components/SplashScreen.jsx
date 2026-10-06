import { useEffect, useState } from "react";
import { useI18n } from "@/i18n";
import "./splash-screen.css";

/**
 * SplashScreen —— 启动页组件
 *
 * 视觉风格与主页高度一致：
 *  - 深邃暗青色渐变背景（#00121f → #01172a）
 *  - 发光亮青色 LOGO（#00d4c8），带 box-shadow 发光感
 *  - 柔和米白色文本
 *
 * LOGO 图形构成：纯 SVG 手动构建，由数个「完全相同半径的圆形」交叠拼接而成。
 *  - 上方圆形交集轮廓形成「山峰」
 *  - 下方多个圆形交集轮廓形成连绵「海浪」
 *
 * 动画叙事分镜（总长约 1.5 - 2.0 秒）：
 *  阶段 1 (0s - 0.5s)  ：同半径圆形线稿以弹跳旋转动效依次浮现
 *  阶段 2 (0.5s - 1.0s)：线条平滑融合为亮色实体填充，呈现完整山海 LOGO
 *  阶段 3 (1.0s - 1.3s)：从山峰上方落下发光小圆点，点亮整个界面
 *  阶段 4 (1.3s - 1.8s)：LOGO 呼吸缩小，整个容器优雅淡出
 *
 * 业务逻辑：
 *  - 动画结束后触发 onFinish 回调，从 DOM 树移除
 *  - 移动端优化：覆盖整个 viewport，禁止滚动与双击缩放
 *  - sessionStorage (hasSeenSplash) 确保当前会话仅首次打开播放
 */
export default function SplashScreen({ onFinish }) {
  const { locale } = useI18n();
  const isZh = (locale || "zh").startsWith("zh");
  const [hidden, setHidden] = useState(false);

  // sessionStorage 控制当前会话仅首次播放
  useEffect(() => {
    try {
      if (sessionStorage.getItem("hasSeenSplash") === "1") {
        setHidden(true);
        onFinish?.();
        return;
      }
    } catch {
      // 隐私模式 / SSR 环境下 sessionStorage 可能不可用，忽略并继续播放
    }

    // 锁定 body 滚动，防止启动页背后页面滑动
    const prevOverflow = document.body.style.overflow;
    const prevTouchAction = document.body.style.touchAction;
    document.body.style.overflow = "hidden";
    document.body.style.touchAction = "none";

    // 动画总时长 ~1.8s，预留余量后触发 onFinish
    const timer = setTimeout(() => {
      try {
        sessionStorage.setItem("hasSeenSplash", "1");
      } catch {
        // ignore
      }
      onFinish?.();
    }, 1900);

    return () => {
      clearTimeout(timer);
      document.body.style.overflow = prevOverflow;
      document.body.style.touchAction = prevTouchAction;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 已播放过则不渲染
  if (hidden) return null;

  return (
    <div
      className="splash-root"
      role="dialog"
      aria-label={isZh ? "山海同行启动页" : "Travel Together Splash"}
    >
      {/* LOGO 容器：负责整体呼吸缩小 + 淡出 */}
      <div className="splash-logo-wrap">
        {/* 山海 LOGO —— 纯 SVG，同半径圆形交叠 */}
        <svg
          className="splash-svg"
          viewBox="0 0 200 200"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          {/* 上方：山峰（3 个同半径圆形交叠，交集轮廓形成山形） */}
          <circle className="splash-circle splash-circle-peak-1" cx="70" cy="95" r="42" />
          <circle className="splash-circle splash-circle-peak-2" cx="100" cy="85" r="42" />
          <circle className="splash-circle splash-circle-peak-3" cx="130" cy="95" r="42" />

          {/* 下方：海浪（4 个同半径圆形交叠，形成连绵波浪） */}
          <circle className="splash-circle splash-circle-wave-1" cx="50" cy="140" r="30" />
          <circle className="splash-circle splash-circle-wave-2" cx="85"