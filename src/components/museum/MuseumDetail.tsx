import { useEffect, useState, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "@tanstack/react-router";
import {
  X,
  MapPin,
  Clock,
  Pencil,
  Save,
  Download,
  Bookmark,
  ChevronDown,
  Plus,
  Trash2,
  Camera,
  ImagePlus,
  Search,
  Globe,
  MapPinned,
  AlertTriangle,
  Loader2,
  ZoomIn,
  LocateFixed,
  Navigation,
  ExternalLink,
} from "lucide-react";
import { getDeepLinks, getDeepLinksBySearch, type MapAppLink } from "@/lib/navigation";
import type { Museum, Exhibit, Attachment } from "./museumData";
import { useT, useI18n } from "@/i18n";
import { getOptimizedImageUrl, getHighResImageUrl } from "@/lib/utils";
import { geocodeVenuePrecise } from "@/lib/geocode";
import {
  getLocalizedCountry,
  getLocalizedCity,
  getAllCountries,
  getAllCities,
  getCitiesByCountry,
  type CountryEntry,
  type CityEntry,
  type Locale,
} from "@/constants/locations";
import { uploadImageToStorage, uploadHighResImageToStorage, compressHighResImage } from "@/lib/compress-image";
import { extractMuseumDocBlocks, parseMuseumDocument } from "@/lib/museum-doc-parser";
import { PhotoImage, usePhotoUrl } from "@/components/signed-image";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Props {
  museum: Museum | null;
  /**
   * 新建模式：true 时强制进入编辑态并初始化空草稿，
   * 用于从 FAB "新增百科" 按钮唤起的弹窗。
   */
  isNew?: boolean;
  onClose: () => void;
  onSave: (updated: Museum) => void;
  onTogglePlanned: (id: string) => void;
  /** 删除回调：由父组件实现 Supabase 删除 + 刷新列表 */
  onDelete?: (id: string) => Promise<boolean>;
  /**
   * 「一键跳转地图定位」回调：由父组件（地图内弹窗）接管时直接调用；
   * 未提供时走默认链路 —— 跳转至地图模块并携带 ?museum=<id> 深链飞行定位。
   * coords：无坐标条目实时反算成功后回传的最新坐标（父组件可直接飞行，无需等 DB 重拉）。
   */
  onLocateOnMap?: (coords?: { lat: number; lng: number }) => void;
  /** 当前行程 ID — 用于 Storage 上传路径前缀 */
  tripId: string;
  /**
   * 关闭按钮位置：地图模块传 'left' 避开右上角浮动卡片遮挡；
   * 默认 'right'（信息模块百科列表等场景保持右上角）。
   */
  closeButtonPosition?: "left" | "right";
}

export function MuseumDetail({
  museum,
  isNew = false,
  onClose,
  onSave,
  onTogglePlanned,
  onDelete,
  onLocateOnMap,
  tripId,
  closeButtonPosition = "right",
}: Props) {
  const t = useT();
  const { locale } = useI18n();
  const isEn = locale === "en";
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Museum | null>(null);
  // 重新精准定位按钮的加载态（三级建筑级地理编码进行中）
  const [locating, setLocating] = useState(false);
  // 「一键跳转地图定位」无坐标时的实时反算加载态（按钮转圈防重复点击）
  const [locatingOnMap, setLocatingOnMap] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [coverPreview, setCoverPreview] = useState<string>("");
  // 待上传封面 File — 保存时上传至 Storage，数据库仅存路径（彻底废除 Base64）
  const [coverFile, setCoverFile] = useState<File | null>(null);
  // ========== 高清导览图 (attachments) 状态 ==========
  // 待上传导览图 File Map：<attachmentId, File> — 保存时走高清通道 (4096px/2MB) 上传至 Storage
  const [attachmentFiles, setAttachmentFiles] = useState<Record<string, File>>({});
  // 导览图文件输入 ref（multiple 多选）
  const mapsInputRef = useRef<HTMLInputElement>(null);
  // 导览图批量压缩中状态
  const [isCompressingMaps, setIsCompressingMaps] = useState(false);
  // 高清导览图全屏预览 — 独立于 lightboxSrc，走 getHighResImageUrl 无宽度限制通道
  const [mapLightboxSrc, setMapLightboxSrc] = useState<string | null>(null);
  // 代表作品图片预览 Map：<exhibitId, previewUrl>
  const [exhibitPreviews, setExhibitPreviews] = useState<Record<string, string>>({});
  // 代表作品待上传 File Map：<exhibitId, File> — 保存时批量上传至 Storage
  const [exhibitFiles, setExhibitFiles] = useState<Record<string, File>>({});
  // Location Picker 状态：null = 关闭，"country" / "city" = 选择对应字段
  const [pickerOpen, setPickerOpen] = useState<null | "country" | "city">(null);
  // 删除确认弹窗状态
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // 任务 4：未保存修改警告弹窗状态（替换原生 window.confirm）
  // - confirmExhibitDiscard：展品编辑弹窗的未保存拦截
  // - confirmExhibitDelete：展品编辑弹窗内的删除二次确认
  // - confirmMuseumDiscard：主弹窗的未保存拦截
  const [confirmExhibitDiscard, setConfirmExhibitDiscard] = useState(false);
  const [confirmExhibitDelete, setConfirmExhibitDelete] = useState(false);
  const [confirmMuseumDiscard, setConfirmMuseumDiscard] = useState(false);
  // 保存中状态 — 图片上传至 Storage 期间显示加载指示
  const [saving, setSaving] = useState(false);
  // 文档导入中状态 — 解析 Word/TXT/MD 并自动填充表单期间显示加载指示
  const [importing, setImporting] = useState(false);
  // 文档导入文件输入 ref（隐藏 input，由「导入」胶囊按钮触发）
  const docImportInputRef = useRef<HTMLInputElement>(null);
  // 全屏图片预览 — 非编辑态点击主图/展品图触发放大（对齐票据模块 ReceiptDetailModal 实现）
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  // 展品详情弹窗 — 非编辑态点击展品卡片唤起居中大弹窗，展示大图+作品简介+历史故事
  const [exhibitModalId, setExhibitModalId] = useState<string | null>(null);
  // 多地图导航 ActionSheet：navLinks 为当前待跳转的深链列表
  const [mapSheetOpen, setMapSheetOpen] = useState(false);
  const [navLinks, setNavLinks] = useState<MapAppLink[]>([]);

  // ========== 终极安全强化：主弹窗 isDirty 检测 ==========
  // 进入编辑态时快照 draft 的 JSON 字符串，用于深度对比检测是否有未保存修改。
  // 覆盖所有字段（名称/简介/地址/展品数组等）+ 图片文件变化（coverFile/exhibitFiles）。
  const [museumEditInitialJson, setMuseumEditInitialJson] = useState<string>("");

  // ========== 任务 1：书签状态隔离 ==========
  // 追踪上一次的 museum.id，用于区分"切换到不同博物馆"与"仅 planned 状态变化"。
  // 当仅 planned 变化时（同一博物馆），绝不重置封面加载状态，避免主图消失。
  const prevMuseumIdRef = useRef<string | null>(null);

  // ========== 任务 2：展品编辑弹窗状态 ==========
  // exhibitEditId: null = 弹窗关闭；string = 当前编辑的展品 id（新展品使用临时生成的 id）
  const [exhibitEditId, setExhibitEditId] = useState<string | null>(null);
  // exhibitEditDraft: 弹窗内的工作副本，保存时同步回 draft.exhibits
  const [exhibitEditDraft, setExhibitEditDraft] = useState<Exhibit | null>(null);
  // exhibitEditInitial: 打开弹窗时的初始快照，用于 isDirty 检测（任务 4 防误触）
  const [exhibitEditInitial, setExhibitEditInitial] = useState<Exhibit | null>(null);
  // 展品编辑弹窗专用文件输入 ref
  const exhibitEditFileInputRef = useRef<HTMLInputElement>(null);

  // 封面图签名 URL 解析：兼容 Storage 路径 / http URL / ObjectURL / Base64
  // 浏览态展示数据库中的 Storage 路径时，自动走本地 IndexedDB 私密缓存链路解析
  const resolvedCover = usePhotoUrl(draft?.cover);
  // 封面图加载状态：onLoad 触发前显示骨架屏，平滑过渡到真实图片
  const [coverLoaded, setCoverLoaded] = useState(false);
  // 封面图 img 元素 ref：用于二次打开弹窗时校验浏览器缓存状态
  const coverImgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const currentId = museum?.id ?? null;
    const isSameMuseum = prevMuseumIdRef.current === currentId;

    if (isSameMuseum && draft) {
      // 任务 1：同一博物馆仅 planned 状态变化（书签切换）——
      // 绝不重置封面加载状态，只同步 draft.planned 避免主图消失
      if (draft.planned !== museum?.planned) {
        setDraft({ ...draft, planned: museum?.planned });
      }
      return;
    }

    // 切换到不同博物馆：执行完整重置
    prevMuseumIdRef.current = currentId;
    setDraft(museum);
    // 新建模式自动进入编辑态，否则重置为浏览态
    setEditing(isNew);
    setCoverPreview(museum?.cover || "");
    setCoverFile(null);
    setAttachmentFiles({});
    setMapLightboxSrc(null);
    setExhibitPreviews({});
    setExhibitFiles({});
    // 切换博物馆时重置封面加载状态，确保新图也显示骨架屏
    setCoverLoaded(false);
    // 关闭可能遗留的展品详情弹窗和展品编辑弹窗
    setExhibitModalId(null);
    setExhibitEditId(null);
    setExhibitEditDraft(null);
    setExhibitEditInitial(null);
    // 终极安全强化：新建模式进入编辑态时快照初始数据，用于 isDirty 检测
    setMuseumEditInitialJson(museum ? JSON.stringify(museum) : "");
  }, [museum, isNew]);

  // 任务 1：修复二次打开弹窗时图片黑屏 Bug
  // 浏览器缓存导致 React onLoad 不触发，img 永远卡在 loaded=false (opacity-0)。
  // 解决方案：在 src 变化时，通过 useRef 强制校验 img.complete 缓存状态，
  // 命中缓存则瞬间无缝显示；未命中则等待 onLoad 触发。
  useEffect(() => {
    setCoverLoaded(false);
    // useEffect 在 React commit 后同步执行，此时 img 已挂载到 DOM。
    // 若图片已被浏览器缓存，img.complete 会立即为 true，强制显示避免黑屏。
    if (coverImgRef.current && coverImgRef.current.complete) {
      setCoverLoaded(true);
    }
  }, [coverPreview, resolvedCover]);

  // 图片压缩中状态：封面 + 代表作品（按 exhibitId 标记），压缩期间显示加载指示
  const [isCompressingCover, setIsCompressingCover] = useState(false);
  const [compressingExhibitId, setCompressingExhibitId] = useState<string | null>(null);

  // 触发封面文件选择器
  const handleCoverClick = () => {
    if (!editing) return; // 浏览态禁止触发
    imageInputRef.current?.click();
  };

  // 读取选中的封面文件：压缩为 File 并用 ObjectURL 即时预览，保存时上传至 Storage
  const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsCompressingCover(true);
    try {
      const { compressImageToFile } = await import("@/lib/compress-image");
      const compressed = await compressImageToFile(file);
      setCoverFile(compressed);
      const objectUrl = URL.createObjectURL(compressed);
      setCoverPreview(objectUrl);
    } catch (err) {
      console.error("Image compress failed:", err);
      toast.error(isEn ? "Image processing failed" : "图片处理失败");
      setCoverPreview("");
      setCoverFile(null);
    } finally {
      setIsCompressingCover(false);
    }
  };

  // ========== 高清导览图 (attachments) 上传/管理逻辑 ==========
  /**
   * 多选读取导览图文件：走高清压缩通道 (4096px / 2MB，质量 0.92 起)，
   * 绕过普通照片的 1280px 强压缩限制，保留地图文字锐度。
   * 严格校验仅放行图片格式 (image/*)，拒绝 PDF 等非图片文件 ——
   * 非 图片无法被 wsrv.nl CDN 代理转 WebP，直连拉取会消耗 Supabase Egress 流量。
   * 每个文件生成附件条目 { id, title(默认文件名), url(ObjectURL 预览) }，
   * 保存时统一上传至 Storage 并替换为路径。
   */
  const handleMapsChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length || !draft) return;

    // 运行时二次防线：accept="image/*" 仅约束文件选择器，拖拽/部分安卓机型仍可选非图片
    const imageFiles = files.filter((f) => f.type.startsWith("image/"));
    const rejectedCount = files.length - imageFiles.length;
    if (rejectedCount > 0) {
      toast.error(
        isEn
          ? `${rejectedCount} file(s) skipped: images only (PDF not supported)`
          : `已跳过 ${rejectedCount} 个文件：仅支持图片格式（不支持 PDF）`,
      );
    }
    if (!imageFiles.length) {
      if (e.target) e.target.value = "";
      return;
    }

    setIsCompressingMaps(true);
    try {
      const newAttachments: Attachment[] = [];
      const newFiles: Record<string, File> = {};
      for (const file of imageFiles) {
        // 高清通道：≤2MB 原样保留，>2MB 压缩至 4096px 内并保持高质量
        const blob = await compressHighResImage(file);
        const asFile =
          blob instanceof File
            ? blob
            : new File([blob], file.name, { type: blob.type, lastModified: Date.now() });
        const id = `map-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        newFiles[id] = asFile;
        newAttachments.push({
          id,
          title: file.name.replace(/\.[^/.]+$/, ""),
          url: URL.createObjectURL(asFile),
        });
      }
      setAttachmentFiles((prev) => ({ ...prev, ...newFiles }));
      setDraft((prev) =>
        prev
          ? { ...prev, attachments: [...(prev.attachments ?? []), ...newAttachments] }
          : prev,
      );
    } catch (err) {
      console.error("Guided map compress failed:", err);
      toast.error(isEn ? "Map image processing failed" : "导览图处理失败");
    } finally {
      setIsCompressingMaps(false);
      if (e.target) e.target.value = "";
    }
  };

  /** 删除单张导览图：移除附件条目及对应待上传文件 */
  const handleAttachmentDelete = (id: string) => {
    setAttachmentFiles((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    if (draft) {
      setDraft({
        ...draft,
        attachments: (draft.attachments ?? []).filter((a) => a.id !== id),
      });
    }
  };

  /** 编辑导览图标题（如 "Uffizi 1F Map"） */
  const updateAttachmentTitle = (id: string, title: string) => {
    if (!draft) return;
    setDraft({
      ...draft,
      attachments: (draft.attachments ?? []).map((a) =>
        a.id === id ? { ...a, title } : a,
      ),
    });
  };

  // ========== 终极安全强化：Esc 键全局拦截 ==========
  // 使用 ref 模式：useEffect 仅注册一次 keydown 监听器，
  // escHandlerRef.current 在每次 render 后更新为最新闭包（含已定义的 close 函数）。
  // 优先级：灯箱 > 展品编辑弹窗 > Location Picker > 删除确认 > 主弹窗
  const escHandlerRef = useRef<() => void>(() => {});
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      escHandlerRef.current();
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, []);

  if (!museum || !draft) return null;

  // 导览图列表（浏览/编辑态共用渲染源）
  const mapsList = draft.attachments ?? [];

  // 每次 render 后更新 Esc 处理器为最新闭包（此时下方所有 close 函数已定义）
  escHandlerRef.current = () => {
    if (mapLightboxSrc) {
      setMapLightboxSrc(null);
      return;
    }
    if (lightboxSrc) {
      setLightboxSrc(null);
      return;
    }
    // 优先关闭顶层警告/确认弹窗（保留底层表单状态，避免误触卸载）
    if (confirmExhibitDiscard) {
      setConfirmExhibitDiscard(false);
      return;
    }
    if (confirmExhibitDelete) {
      setConfirmExhibitDelete(false);
      return;
    }
    if (confirmMuseumDiscard) {
      setConfirmMuseumDiscard(false);
      return;
    }
    if (exhibitEditId) {
      closeExhibitEditWithConfirm();
      return;
    }
    if (pickerOpen) {
      setPickerOpen(null);
      return;
    }
    if (confirmDelete) {
      setConfirmDelete(false);
      return;
    }
    closeMuseumDetailWithConfirm();
  };

  const updateField = <K extends keyof Museum>(key: K, value: Museum[K]) =>
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));

  /** 重新精准定位：按当前表单的地址/名称手动触发三级建筑级地理编码，
   *  命中后即时更新 draft 坐标（保存时随 payload 一并写入 DB），
   *  三级均失败则提示并保持坐标不变（不回退城市中心）。 */
  const handleRelocate = async () => {
    if (!draft) return;
    setLocating(true);
    try {
      const geo = await geocodeVenuePrecise({
        name: draft.name,
        foreignName: draft.nameCn,
        address: draft.address,
        cityKey: draft.cityKey,
        countryKey: draft.countryKey,
      });
      if (geo) {
        updateField("latitude", geo.lat);
        updateField("longitude", geo.lng);
        toast.success(
          isEn
            ? `Located: ${geo.lat.toFixed(5)}, ${geo.lng.toFixed(5)}`
            : `定位成功: ${geo.lat.toFixed(5)}, ${geo.lng.toFixed(5)}`,
        );
      } else {
        toast.warning(
          isEn
            ? "No exact match found. Try a more detailed address or a foreign landmark name."
            : "未匹配到具体建筑坐标，请尝试更详细的地址或外文地标名。",
        );
      }
    } finally {
      setLocating(false);
    }
  };

  // ========== 导入文档自动填充（Word / TXT / MD） ==========

  /** 将解析出的国家文本归一化为词库 key（未命中时原样保留，走自定义名称显示逻辑） */
  const resolveCountryKey = (raw: string): string => {
    const target = raw.trim();
    if (!target) return "";
    const lower = target.toLowerCase();
    const hit = getAllCountries().find(
      (c) => c.key === lower || c.en.toLowerCase() === lower || c.zh === target,
    );
    return hit ? hit.key : target;
  };

  /** 将解析出的城市文本归一化为词库 key（优先在已匹配国家内查找，其次全局查找） */
  const resolveCityKey = (raw: string, countryKey: string): string => {
    const target = raw.trim();
    if (!target) return "";
    const lower = target.toLowerCase();
    const inCountry = getCitiesByCountry(countryKey).find(
      (c) => c.key === lower || c.en.toLowerCase() === lower || c.zh === target,
    );
    if (inCountry) return inCountry.key;
    const global = getAllCities().find(
      (c) => c.key === lower || c.en.toLowerCase() === lower || c.zh === target,
    );
    return global ? global.key : target;
  };

  /**
   * 导入文档：提取块流（文本 + 图片）-> 结构化解析 -> 直接填充当前表单 draft。
   * - 标题中文优先：名称行同时含中外文时（如「圣马可大教堂 Basilica di San Marco」），
   *   主【名称/标题】框填中文名称，外文部分存入副标题（nameCn 位置，浏览态小字显示）。
   * - 图片自动关联：按文档位置路由 —— 顶部图片 -> 封面、展品描述下方图片 -> 该展品照片、
   *   【导览图】章节图片 -> attachments。data: URI（docx 内嵌）转 File 走压缩上传通道，
   *   http(s) URL（md/txt 链接）直接绑定（显示层与保存通道均兼容远程 URL）。
   * 仅更新前端 State，不自动提交数据库；保留编辑态供用户核对、预览已提取图片，
   * 确认无误后点击保存按钮统一走 commit 上传通道。
   */
  const handleImportDoc = async (file: File | undefined) => {
    if (!file || importing || saving) return;
    const lower = file.name.toLowerCase();
    const supported = [".docx", ".txt", ".md", ".markdown"].some((ext) => lower.endsWith(ext));
    if (!supported) {
      toast.error(
        isEn ? "Please upload a .docx, .txt or .md file" : "请上传 .docx、.txt 或 .md 文件",
      );
      return;
    }
    setImporting(true);
    try {
      // 1. 提取块流：.docx 走 mammoth（内嵌图片转 data URI），.md/.txt 识别图片链接行
      const blocks = await extractMuseumDocBlocks(file);
      // 2. 结构化解析（名称/国家/城市/地址/开放时间/简介/核心展品 + 封面/展品/导览图）
      const parsed = parseMuseumDocument(blocks);

      const hasContent = !!(
        parsed.name ||
        parsed.nameCn ||
        parsed.country ||
        parsed.city ||
        parsed.address ||
        parsed.hours ||
        parsed.intro ||
        parsed.exhibits.length > 0 ||
        parsed.coverImage ||
        parsed.guideImages.length > 0
      );
      if (!hasContent) {
        toast.error(
          isEn
            ? "No recognizable fields found in the document"
            : "未能从文档中识别出有效内容",
        );
        return;
      }

      // 3. 图片源处理：data: URI -> File（fetch blob）；远程 URL 保持原样直接绑定
      const { compressImageToFile, compressHighResImage } = await import("@/lib/compress-image");
      const isRemote = (src: string) => /^https?:\/\//i.test(src);
      const srcToFile = async (src: string, name: string): Promise<File | null> => {
        try {
          const res = await fetch(src);
          if (!res.ok) return null;
          const blob = await res.blob();
          if (!blob.type.startsWith("image/") || blob.size === 0) return null;
          return new File([blob], name, { type: blob.type, lastModified: Date.now() });
        } catch {
          return null;
        }
      };

      // 4. 封面：文档顶部/【封面图片】图片 -> 预览 + 待上传 File（普通压缩通道）
      let nextCoverFile: File | null = null;
      let nextCoverPreview = "";
      if (parsed.coverImage) {
        const src = parsed.coverImage.src;
        if (isRemote(src)) {
          nextCoverPreview = src;
        } else {
          const raw = await srcToFile(src, "imported-cover");
          if (raw) {
            nextCoverFile = await compressImageToFile(raw);
            nextCoverPreview = URL.createObjectURL(nextCoverFile);
          } else {
            nextCoverPreview = src; // 兜底：data URI 直接预览
          }
        }
      }

      // 5. 展品：中文优先填充主名称框（外文存入副标题）；展品图片绑定预览与待上传 File
      const stamp = Date.now();
      const nextExhibitFiles: Record<string, File> = {};
      const nextExhibitPreviews: Record<string, string> = {};
      const nextExhibits: Exhibit[] = [];
      for (let i = 0; i < parsed.exhibits.length; i++) {
        const ex = parsed.exhibits[i];
        const id = `imported-${stamp}-${i}`;
        let image = "";
        if (ex.image) {
          const src = ex.image.src;
          if (isRemote(src)) {
            image = src;
          } else {
            const raw = await srcToFile(src, `exhibit-${i + 1}`);
            if (raw) {
              const compressed = await compressImageToFile(raw);
              nextExhibitFiles[id] = compressed;
              image = URL.createObjectURL(compressed);
            } else {
              image = src;
            }
          }
        }
        if (image) nextExhibitPreviews[id] = image;
        nextExhibits.push({
          id,
          // 标题中文优先：双语名称行 -> 主名称框填中文，外文部分存入副标题（nameCn）
          name: ex.nameCn || ex.name,
          nameCn: ex.nameCn ? ex.name : "",
          image,
          background: ex.background,
          story: ex.story,
        });
      }

      // 6. 导览图：【导览图】章节图片 -> attachments（data: URI 走 4096px 高清压缩通道）
      const nextAttachmentFiles: Record<string, File> = {};
      const nextAttachments: Attachment[] = [];
      for (let i = 0; i < parsed.guideImages.length; i++) {
        const gi = parsed.guideImages[i];
        const id = `map-${stamp}-${i}`;
        let url = gi.src;
        if (!isRemote(gi.src)) {
          const raw = await srcToFile(gi.src, `guide-map-${i + 1}`);
          if (raw) {
            const blob = await compressHighResImage(raw);
            const asFile =
              blob instanceof File
                ? blob
                : new File([blob], raw.name, { type: blob.type, lastModified: Date.now() });
            nextAttachmentFiles[id] = asFile;
            url = URL.createObjectURL(asFile);
          }
        }
        nextAttachments.push({
          id,
          title: isEn ? `Guide Map ${i + 1}` : `导览图 ${i + 1}`,
          url,
        });
      }

      // 7. 填充当前表单 State（仅覆盖文档中真实解析到的字段）
      setDraft((prev) => {
        if (!prev) return prev;
        const next: Museum = { ...prev };
        // 标题中文优先：双语标题行 -> 主【名称/标题】框填中文，外文部分存入副标题（nameCn）
        if (parsed.nameCn) {
          next.name = parsed.nameCn;
          next.nameCn = parsed.name ?? "";
        } else if (parsed.name) {
          next.name = parsed.name;
        }
        if (parsed.country) {
          next.countryKey = resolveCountryKey(parsed.country);
          // 国家变化后，原城市若不属于新国家且文档未提供城市，则清空保持联动一致
          const cityStillValid =
            !next.cityKey ||
            getCitiesByCountry(next.countryKey).some((c) => c.key === next.cityKey);
          if (!cityStillValid && !parsed.city) next.cityKey = "";
        }
        if (parsed.city) next.cityKey = resolveCityKey(parsed.city, next.countryKey);
        if (parsed.address) next.address = parsed.address;
        if (parsed.hours) next.hours = parsed.hours;
        if (parsed.intro) next.intro = parsed.intro;
        // 隐形高精坐标：文档预埋即直接采用（保存链路检测到坐标已存在会跳过网络地理编码）
        if (parsed.latitude != null && parsed.longitude != null) {
          next.latitude = parsed.latitude;
          next.longitude = parsed.longitude;
        }
        if (nextExhibits.length > 0) next.exhibits = nextExhibits;
        if (parsed.coverImage) next.cover = nextCoverPreview;
        if (nextAttachments.length > 0) {
          next.attachments = [...(next.attachments ?? []), ...nextAttachments];
        }
        return next;
      });

      // 8. 绑定图片状态：待上传 File（commit 时统一上传 Storage）+ 预览 URL
      if (parsed.coverImage) {
        setCoverFile(nextCoverFile);
        setCoverPreview(nextCoverPreview);
      }
      if (Object.keys(nextExhibitFiles).length > 0) setExhibitFiles(nextExhibitFiles);
      if (Object.keys(nextExhibitPreviews).length > 0) setExhibitPreviews(nextExhibitPreviews);
      if (Object.keys(nextAttachmentFiles).length > 0) setAttachmentFiles(nextAttachmentFiles);

      const imgCount =
        (parsed.coverImage ? 1 : 0) +
        Object.keys(nextExhibitPreviews).length +
        nextAttachments.length;
      toast.success(
        isEn
          ? `Imported successfully${imgCount ? ` (${imgCount} image(s))` : ""}. Please review and click save.`
          : `导入成功${imgCount ? `（含 ${imgCount} 张图片）` : ""}，请核对内容后点击保存`,
      );
    } catch (err) {
      console.error("Museum document import failed:", err);
      toast.error(
        err instanceof Error ? err.message : isEn ? "Import failed" : "导入失败",
      );
    } finally {
      setImporting(false);
      // 重置 input value，允许重复选择同一文件
      if (docImportInputRef.current) docImportInputRef.current.value = "";
    }
  };

  // ========== 任务 2：展品编辑弹窗 helper 函数 ==========

  /**
   * 打开展品编辑弹窗。
   * - 传入已有展品：进入编辑模式，复制一份工作副本到 exhibitEditDraft。
   * - 传入 null：进入新增模式，生成临时 id 和空草稿。
   * 弹窗内所有修改只影响 exhibitEditDraft，点击【保存展品】后才同步回 draft.exhibits。
   * 同时保存初始快照到 exhibitEditInitial，用于 isDirty 检测（任务 4 防误触）。
   */
  const openExhibitEditDialog = (exhibit: Exhibit | null) => {
    if (!draft) return;
    if (exhibit) {
      // 编辑现有展品：复制一份工作副本，避免直接修改 draft
      const snapshot: Exhibit = { ...exhibit };
      setExhibitEditId(exhibit.id);
      setExhibitEditDraft({ ...snapshot });
      setExhibitEditInitial({ ...snapshot });
    } else {
      // 新增展品：生成临时 id，所有字段为空
      const newId = `exhibit-${Date.now()}`;
      const blank: Exhibit = {
        id: newId,
        name: "",
        nameCn: "",
        image: "",
        background: "",
        story: "",
      };
      setExhibitEditId(newId);
      setExhibitEditDraft({ ...blank });
      setExhibitEditInitial({ ...blank });
    }
  };

  /** 强制关闭展品编辑弹窗（不校验 isDirty），清空工作副本 */
  const closeExhibitEditDialog = () => {
    setExhibitEditId(null);
    setExhibitEditDraft(null);
    setExhibitEditInitial(null);
  };

  /**
   * 任务 4：带未保存修改确认的关闭逻辑。
   * - 未修改：直接关闭。
   * - 有修改：弹出自定义警告弹窗二次确认，用户选择"确认放弃"才关闭，否则保留编辑状态。
   * 用于右上角 X 按钮和背景遮罩点击的关闭路径。
   */
  const closeExhibitEditWithConfirm = () => {
    if (!exhibitEditDraft || !exhibitEditInitial) {
      closeExhibitEditDialog();
      return;
    }
    const dirty =
      exhibitEditDraft.name !== exhibitEditInitial.name ||
      (exhibitEditDraft.nameCn ?? "") !== (exhibitEditInitial.nameCn ?? "") ||
      exhibitEditDraft.image !== exhibitEditInitial.image ||
      exhibitEditDraft.background !== exhibitEditInitial.background ||
      exhibitEditDraft.story !== exhibitEditInitial.story;
    if (dirty) {
      // 弹出自定义警告弹窗（替换原生 window.confirm）
      // 点击【取消】仅关闭警告弹窗，保留底层展品表单及已输入数据
      // 点击【确认放弃】由 confirmDiscardExhibitEdit 处理：关闭警告 + 清空状态 + 关闭展品表单
      setConfirmExhibitDiscard(true);
      return;
    }
    closeExhibitEditDialog();
  };

  /** 警告弹窗【确认放弃】回调：关闭警告弹窗并正常关闭展品编辑表单（清空状态） */
  const confirmDiscardExhibitEdit = () => {
    setConfirmExhibitDiscard(false);
    closeExhibitEditDialog();
  };

  /** 更新展品编辑弹窗中工作副本的字段 */
  const updateExhibitDraftField = <K extends keyof Exhibit>(key: K, value: Exhibit[K]) => {
    setExhibitEditDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  /**
   * 保存展品：将弹窗内的工作副本同步回 draft.exhibits。
   * - 若 exhibitEditId 已存在于 draft.exhibits 中 → 更新该项。
   * - 若不存在（新增展品）→ 追加到数组末尾。
   * 保存后自动关闭弹窗。
   */
  const saveExhibitFromDialog = () => {
    if (!draft || !exhibitEditDraft || !exhibitEditId) return;
    const exists = draft.exhibits.some((e) => e.id === exhibitEditId);
    if (exists) {
      setDraft({
        ...draft,
        exhibits: draft.exhibits.map((e) =>
          e.id === exhibitEditId ? { ...exhibitEditDraft } : e,
        ),
      });
    } else {
      setDraft({
        ...draft,
        exhibits: [...draft.exhibits, { ...exhibitEditDraft }],
      });
    }
    // 保存成功后强制关闭，无需确认
    closeExhibitEditDialog();
  };

  /**
   * 任务 3：从弹窗内删除当前正在编辑的展品。
   * 仅对已保存到 draft.exhibits 的展品生效（新增未保存的展品直接关闭即可）。
   * 删除前弹出自定义确认弹窗二次确认防误触。
   */
  const deleteCurrentExhibitFromDialog = () => {
    if (!draft || !exhibitEditId) return;
    const exists = draft.exhibits.some((e) => e.id === exhibitEditId);
    if (!exists) {
      // 新增未保存的展品：直接关闭即可，无需删除
      closeExhibitEditDialog();
      return;
    }
    // 弹出自定义删除确认弹窗（替换原生 window.confirm）
    setConfirmExhibitDelete(true);
  };

  /** 展品删除确认弹窗【确认删除】回调 */
  const confirmDeleteExhibitFromDialog = () => {
    setConfirmExhibitDelete(false);
    if (!draft || !exhibitEditId) return;
    setDraft({ ...draft, exhibits: draft.exhibits.filter((e) => e.id !== exhibitEditId) });
    closeExhibitEditDialog();
  };

  /** 展品编辑弹窗：点击图片区域触发文件选择器 */
  const handleExhibitEditImageClick = () => {
    if (!editing) return;
    exhibitEditFileInputRef.current?.click();
  };

  /**
   * 展品编辑弹窗：读取选中文件，压缩为 File 并用 ObjectURL 即时预览。
   * 同时更新 exhibitFiles（commit 时上传至 Storage）和 exhibitEditDraft.image（即时预览）。
   */
  const handleExhibitEditImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!exhibitEditId || !exhibitEditDraft) return;
    const file = e.target.files?.[0];
    if (!file) return;

    setCompressingExhibitId(exhibitEditId);
    try {
      const { compressImageToFile } = await import("@/lib/compress-image");
      const compressed = await compressImageToFile(file);
      // 存储待上传文件（commit 时上传至 Storage）
      setExhibitFiles((prev) => ({ ...prev, [exhibitEditId]: compressed }));
      // 创建 ObjectURL 用于即时预览
      const objectUrl = URL.createObjectURL(compressed);
      setExhibitPreviews((prev) => ({ ...prev, [exhibitEditId]: objectUrl }));
      // 同步更新草稿的 image 字段，保存时写入 draft.exhibits
      setExhibitEditDraft((prev) => (prev ? { ...prev, image: objectUrl } : prev));
    } catch (err) {
      console.error("Image compress failed:", err);
      toast.error(isEn ? "Image processing failed" : "图片处理失败");
    } finally {
      setCompressingExhibitId(null);
      // 重置 input value，允许重复选择同一文件
      if (e.target) e.target.value = "";
    }
  };

  // ========== 终极安全强化：主弹窗 isDirty 检测与防误触关闭 ==========
  /**
   * isMuseumDirty: 编辑态下检测用户是否真实修改过内容。
   * - 对比 draft 的 JSON 与进入编辑态时的快照（覆盖名称/简介/地址/展品数组等所有字段）
   * - 额外检测图片文件变化（coverFile / exhibitFiles），因为图片选择不修改 draft 而是单独存储
   */
  const isMuseumDirty = editing && draft && (
    JSON.stringify(draft) !== museumEditInitialJson ||
    coverFile !== null ||
    Object.keys(exhibitFiles).length > 0 ||
    Object.keys(attachmentFiles).length > 0
  );

  /**
   * 带未保存修改确认的关闭逻辑（主弹窗）。
   * - 浏览态或无修改：直接调用 onClose 关闭弹窗。
   * - 编辑态且有未保存修改：弹出自定义警告弹窗二次确认，
   *   用户选择"确认放弃"才放弃修改并关闭，选择"取消"则保留编辑状态。
   * 覆盖 X 按钮、遮罩点击、Esc 键三大关闭通道。
   */
  const closeMuseumDetailWithConfirm = () => {
    if (isMuseumDirty) {
      // 弹出自定义警告弹窗（替换原生 window.confirm）
      setConfirmMuseumDiscard(true);
      return;
    }
    onClose();
  };

  /** 主弹窗警告弹窗【确认放弃】回调：关闭警告并关闭主弹窗 */
  const confirmDiscardMuseumEdit = () => {
    setConfirmMuseumDiscard(false);
    onClose();
  };

  /**
   * 进入编辑模式：同时快照当前 draft 的 JSON，作为 isDirty 对比基准。
   * 用于"编辑"按钮点击时记录初始状态。
   */
  const enterEditMode = () => {
    setMuseumEditInitialJson(draft ? JSON.stringify(draft) : "");
    setEditing(true);
  };

  /**
   * 「一键跳转地图定位」：浏览态定位图标按钮点击。
   * - 已有坐标：父组件（地图内弹窗）提供 onLocateOnMap 时由其接管（就地飞行定位）；
   *   否则默认链路：跳转至地图模块（携带 ?museum=<id> 深链，路由切换
   *   自动关闭当前百科弹窗），地图侧飞行聚焦并弹出轻量预览气泡。
   * - 坐标缺失（数据包导入等场景）：不再直接报错 —— 立即调用三级建筑级
   *   地理编码实时反算坐标，命中后回写 Supabase encyclopedia_items
   *   （等待完成，确保地图模块拉取到新坐标后深链飞行生效），再切换地图飞行定位；
   *   仅当地址完全无法解析时才弹出错误提示。
   */
  const handleLocateOnMap = async () => {
    if (!museum || locatingOnMap) return;
    const lat = museum.latitude;
    const lng = museum.longitude;
    const hasCoords =
      lat != null &&
      lng != null &&
      Number.isFinite(lat) &&
      Number.isFinite(lng) &&
      !(lat === 0 && lng === 0);

    if (hasCoords) {
      if (onLocateOnMap) {
        onLocateOnMap();
        return;
      }
      navigate({
        to: "/trips/$tripId",
        params: { tripId },
        search: { museum: museum.id },
      });
      return;
    }

    // ── 无坐标：即时反算（权威地标字典 → 结构化地址 → 外文/中文地标名三级流水线）──
    setLocatingOnMap(true);
    try {
      const geo = await geocodeVenuePrecise({
        name: museum.name,
        foreignName: museum.nameCn,
        address: museum.address,
        cityKey: museum.cityKey,
        countryKey: museum.countryKey,
      });
      if (!geo) {
        toast.error(
          isEn
            ? "Address could not be resolved, unable to locate"
            : "地址无法解析，暂时无法定位",
        );
        return;
      }
      // 回写数据库：等待完成，确保地图模块深链拉取到新坐标后飞行生效
      const { error: upErr } = await (supabase as any)
        .from("encyclopedia_items")
        .update({ latitude: geo.lat, longitude: geo.lng })
        .eq("id", museum.id);
      if (upErr) console.warn("[MuseumDetail] locate write-back failed:", upErr);
      toast.success(
        isEn
          ? `Located: ${geo.lat.toFixed(5)}, ${geo.lng.toFixed(5)}`
          : `定位成功: ${geo.lat.toFixed(5)}, ${geo.lng.toFixed(5)}`,
      );
      if (onLocateOnMap) {
        onLocateOnMap(geo);
        return;
      }
      navigate({
        to: "/trips/$tripId",
        params: { tripId },
        search: { museum: museum.id },
      });
    } finally {
      setLocatingOnMap(false);
    }
  };

  /**
   * 「一键导航」：浏览态导航图标按钮点击，唤起多地图导航 ActionSheet。
   * - 有有效经纬度时走坐标导航（getDeepLinks，公交模式深链）；
   * - 坐标缺失时降级为「地址 + 城市」搜索导航（getDeepLinksBySearch）；
   * - 两者皆无时双语提示，不弹窗。
   */
  const handleOpenNavigation = (m: Museum) => {
    const lat = m.latitude;
    const lng = m.longitude;
    const hasCoords =
      lat != null &&
      lng != null &&
      Number.isFinite(lat) &&
      Number.isFinite(lng) &&
      !(lat === 0 && lng === 0);
    if (hasCoords) {
      setNavLinks(getDeepLinks({ lat: lat as number, lng: lng as number, title: m.name }));
    } else {
      const city = getLocalizedCity(m.cityKey, locale, m.countryKey);
      const query = [m.address, city].filter(Boolean).join(", ");
      if (!query) {
        toast.error(isEn ? "No location info, unable to navigate" : "暂无位置信息，无法导航");
        return;
      }
      setNavLinks(getDeepLinksBySearch(query));
    }
    setMapSheetOpen(true);
  };

  const commit = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      // 获取当前用户 ID 用于 Storage 上传路径
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      // RLS 约束：checkin-images bucket 要求路径第二段 = auth.uid()，
      // 因此前缀必须为 `${tripId}/${userId}`（不可改为卡片 ID，否则被策略拒绝）
      const pathPrefix = `${tripId}/${user.id}`;

      // 移动端网络抖动兜底：Storage 上传失败时自动重试一次（400ms 退避）
      const withRetry = async <T,>(fn: () => Promise<T>): Promise<T> => {
        try {
          return await fn();
        } catch {
          await new Promise((r) => setTimeout(r, 400));
          return fn();
        }
      };

      // 百科图片（封面/展品/导览图）存入公开桶 public-images：无隐私公共文化资产，
      // 数据库存完整公开直链（渲染端据此自动走 wsrv.nl CDN，0 Supabase Egress）。
      // 旧数据（checkin-images 相对路径）渲染时自动回落私密缓存链路，无需迁移。
      const encPublicUrl = (p: string) =>
        supabase.storage.from("public-images").getPublicUrl(p).data.publicUrl;

      // 1. 上传封面图片至公开桶（如有新文件）。
      //    选图阶段已压缩过 → precompressed 跳过二次压缩（安卓重复 Canvas 是保存失败主嫌疑）
      let coverPath = draft.cover;
      if (coverFile) {
        coverPath = encPublicUrl(
          await withRetry(() =>
            uploadImageToStorage(coverFile, pathPrefix, "public-images", { precompressed: true }),
          ),
        );
      }

      // 2. 上传代表作品图片至公开桶（如有新文件），exhibit.image 存公开直链
      const updatedExhibits = await Promise.all(
        draft.exhibits.map(async (ex) => {
          const pendingFile = exhibitFiles[ex.id];
          if (pendingFile) {
            const imagePath = await withRetry(() =>
              uploadImageToStorage(pendingFile, pathPrefix, "public-images", { precompressed: true }),
            );
            return { ...ex, image: encPublicUrl(imagePath) };
          }
          return ex;
        }),
      );

      // 3. 上传高清导览图至公开桶（如有新文件）——走 4096px/2MB 高清通道
      //    + cacheControl 强缓存头，禁止普通照片的 1280px 强压缩（地图文字必须清晰）
      //    （选图阶段已完成高清压缩，≤2MB 输入在通道内自动透传，无二次损耗）
      const uploadedAttachments = await Promise.all(
        (draft.attachments ?? []).map(async (att) => {
          const pendingFile = attachmentFiles[att.id];
          if (pendingFile) {
            const attPath = await withRetry(() =>
              uploadHighResImageToStorage(pendingFile, pathPrefix, "public-images"),
            );
            return { ...att, url: encPublicUrl(attPath) };
          }
          return att;
        }),
      );

      // 4. 全部图片上传完毕、拿到 Storage 远程路径后，才组装完整数据对象发起数据库写入
      onSave({
        ...draft,
        cover: coverPath,
        exhibits: updatedExhibits,
        attachments: uploadedAttachments,
      });
      setEditing(false);
      setPickerOpen(null);
      // 清理待上传文件状态
      setCoverFile(null);
      setExhibitFiles({});
      setAttachmentFiles({});
    } catch (err) {
      // 详细报错：输出具体 error.message，杜绝模糊的"保存失败"无法定位
      console.error("Save failed:", err);
      const raw = err instanceof Error ? err.message : String(err);
      const reason =
        raw === "IMAGE_TOO_LARGE"
          ? isEn
            ? "Image too large (over 8MB) — please screenshot it and retry"
            : "图片过大（超过 8MB），请截图后重试"
          : raw || "Unknown error";
      toast.error(isEn ? `Save failed: ${reason}` : `保存失败：${reason}`);
    } finally {
      setSaving(false);
    }
  };

  /** 执行删除：调用父级 onDelete，成功后关闭弹窗 */
  const handleDelete = async () => {
    if (!draft?.id || !onDelete) return;
    setDeleting(true);
    try {
      const ok = await onDelete(draft.id);
      if (ok) {
        setConfirmDelete(false);
        onClose();
      }
    } finally {
      setDeleting(false);
    }
  };

  /**
   * Location Picker 选中回调：
   * - 选国家：更新 countryKey，若当前 cityKey 不属于新国家则清空
   * - 选城市：更新 cityKey，同时若 countryKey 为空则同步补齐城市所属国家
   */
  const handlePick = (key: string) => {
    if (!draft) return;
    if (pickerOpen === "country") {
      // 自定义国家（不在预设词库中）直接保存原始字符串
      const next: Museum = { ...draft, countryKey: key };
      const validCities = getCitiesByCountry(key).map((c) => c.key);
      if (!validCities.includes(next.cityKey)) next.cityKey = "";
      setDraft(next);
    } else if (pickerOpen === "city") {
      // 复合 key 格式为 "countryKey:cityKey"；自定义城市无冒号，直接作为 cityKey 保存
      if (key.includes(":")) {
        const [countryKey, cityKey] = key.split(":");
        if (countryKey && cityKey) {
          setDraft({ ...draft, cityKey, countryKey: draft.countryKey || countryKey });
        }
      } else {
        setDraft({ ...draft, cityKey: key });
      }
    }
    setPickerOpen(null);
  };

  const inputCls =
    "w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-brand/40 focus:outline-none focus:ring-2 focus:ring-brand/30";

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6 animate-in fade-in duration-200"
      onClick={closeMuseumDetailWithConfirm}
    >
      <div
        className="relative w-full max-w-3xl max-h-[85vh] bg-card border border-border rounded-3xl flex flex-col overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={closeMuseumDetailWithConfirm}
          aria-label="Close"
          className={`absolute top-4 z-50 ${
            closeButtonPosition === "left" ? "left-4" : "right-4"
          } bg-black/60 hover:bg-black/80 text-white rounded-full p-2 backdrop-blur-md transition`}
        >
          <X className="h-4 w-4" />
        </button>

        {/* 隐藏的真实文件选择框 */}
        <input
          type="file"
          ref={imageInputRef}
          onChange={handleImageChange}
          accept="image/*"
          className="hidden"
        />
        {/* 隐藏的高清导览图文件选择框（多选，仅图片格式 —— PDF 等无法走 CDN 代理转 WebP） */}
        <input
          type="file"
          ref={mapsInputRef}
          onChange={handleMapsChange}
          accept="image/*"
          multiple
          className="hidden"
        />

        {/* 可滚动主体区域：flex-1 + overflow-y-auto + pb-28 确保底部内容完满呈现
            分割线策略：由父容器统一 divide-y 管理（divide-border 语义色自动适配明暗主题），
            Tailwind 只在相邻"有效"子元素之间渲染分割线 —— 板块隐藏时其分割线随之消失，
            首部之前与尾部之后绝不会出现孤立线条。各子板块内部禁止再写 border-b。 */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain [-webkit-overflow-scrolling:touch] scrollbar-thin scrollbar-thumb-slate-700 divide-y divide-border">
          {/* 封面图片区域：浏览态点击放大预览，编辑态点击更换图片 */}
          {(() => {
            // 编辑态优先使用 coverPreview（本地 ObjectURL 压缩预览）；
            // 浏览态必须使用 resolvedCover（usePhotoUrl 已签名的完整 URL），
            // 否则直接传入 Storage 相对路径会导致 <img src="tripId/userId/uuid.jpg"> 加载失败（弹窗主图不显示 Bug 根因）
            const coverSrc = editing ? (coverPreview || resolvedCover) : resolvedCover;
            // coverSrc 变化时重置加载状态（闭包内同步判断，避免 useEffect 时序延迟）
            const coverKey = coverSrc ?? "";
            return (
              <div
                onClick={
                  editing
                    ? handleCoverClick
                    : coverSrc
                      ? () => setLightboxSrc(coverSrc)
                      : undefined
                }
                className={`relative w-full h-56 sm:h-64 overflow-hidden bg-muted ${
                  editing
                    ? "cursor-pointer group"
                    : coverSrc
                      ? "cursor-pointer hover:opacity-90 transition-opacity"
                      : ""
                }`}
              >
                {coverSrc ? (
                  <>
                    {/* 骨架屏背景：图片加载完成前显示呼吸闪烁，加载后平滑淡出 */}
                    {!coverLoaded && (
                      <div className="absolute inset-0 animate-pulse bg-muted/60" aria-hidden />
                    )}
                    <img
                      ref={coverImgRef}
                      key={coverKey}
                      src={getOptimizedImageUrl(coverSrc)}
                      alt={draft.name || 'Encyclopedia Cover'}
                      className={`w-full h-full object-cover transition-opacity duration-500 ${
                        coverLoaded ? "opacity-100" : "opacity-0"
                      } ${editing ? "group-hover:scale-105 transition-transform duration-300" : ""}`}
                      decoding="async"
                      onLoad={() => setCoverLoaded(true)}
                      onError={(e) => {
                        // 图片加载失败时兜底
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                    {isCompressingCover && (
                      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center gap-1.5 z-20">
                        <Loader2 className="w-6 h-6 text-brand animate-spin" />
                        <span className="text-[10px] text-brand font-medium">
                          {isEn ? "Compressing..." : "压缩中..."}
                        </span>
                      </div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-card via-card/60 to-transparent" />
                    {/* 编辑态显示更换图片提示蒙层；浏览态显示查看大图提示 */}
                    {editing ? (
                      <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2 text-brand font-semibold text-sm">
                        <Camera className="w-5 h-5"/>
                        <span>{t("encyclopedia.changeCoverHint")}</span>
                      </div>
                    ) : (
                      <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-xs gap-1 font-medium pointer-events-none">
                        <ZoomIn className="w-4 h-4" />
                        <span>{isEn ? "View full image" : "查看大图"}</span>
                      </div>
                    )}
                  </>
                ) : (
                  /* 无图片时的虚线占位区域 */
                  <div className="w-full h-full border-2 border-dashed border-border hover:border-brand/80 transition-colors flex flex-col items-center justify-center gap-2 text-muted-foreground hover:text-brand">
                    <ImagePlus className="w-8 h-8"/>
                    <span className="text-xs">{t("encyclopedia.uploadCoverHint")}</span>
                  </div>
                )}
              </div>
            );
          })()}

          {/* ========== 顶部操作工具栏 (对齐票据模块 Action Bar) ========== */}
          <div className="flex flex-wrap items-center justify-between gap-2 px-6 py-3.5 bg-card shrink-0">
            {/* 左侧：加入行程按钮 — 使用 draft.planned 而非 museum.planned，
                避免书签切换时 prop 变化触发 useEffect 重置封面加载状态 */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => onTogglePlanned(draft.id)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold flex items-center gap-1.5 transition-all ${
                  draft.planned
                    ? "border border-brand/50 bg-brand/10 text-brand shadow-[0_0_10px_rgba(34,211,238,0.2)]"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                <Bookmark
                  className={`w-3.5 h-3.5 ${draft.planned ? "fill-brand text-brand" : "text-muted-foreground"}`}
                  fill={draft.planned ? "currentColor" : "none"}
                />
                <span>{draft.planned ? t("encyclopedia.planned") : t("encyclopedia.planVisit")}</span>
              </button>
            </div>

            {/* 右侧：操作按钮组 (导入文档 + 红色删除 + 青色保存 / 浏览态铅笔编辑) */}
            <div className="flex items-center gap-3">
              {editing ? (
                <>
                  {/* 导入文档胶囊按钮 — 样式对齐规划模块「导入 Word」按钮（Download 图标 + 文案），
                      点击触发本地文件选择器（.docx/.txt/.md），解析后自动填充表单且不自动提交数据库 */}
                  <label
                    className={`flex items-center gap-1.5 whitespace-nowrap flex-shrink-0 rounded-full border border-border/50 bg-card/80 px-4 py-1.5 text-sm text-foreground transition-all hover:text-brand hover:border-brand/50 ${
                      importing || saving
                        ? "cursor-not-allowed opacity-30 pointer-events-none"
                        : "cursor-pointer"
                    }`}
                    title={
                      isEn
                        ? "Import Word/TXT/MD to auto-fill the form"
                        : "导入 Word/TXT/MD 文档自动填充表单"
                    }
                  >
                    {importing ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Download className="h-3.5 w-3.5" />
                    )}
                    <span>{isEn ? "Import" : "导入"}</span>
                    <input
                      ref={docImportInputRef}
                      type="file"
                      accept=".docx,.txt,.md,.markdown"
                      className="hidden"
                      onChange={(e) => handleImportDoc(e.target.files?.[0])}
                      disabled={importing || saving}
                    />
                  </label>
                  {/* 红色删除按钮：仅编辑现有百科时显示，新建模式不显示 */}
                  {editing && !isNew && onDelete && (
                    <button
                      onClick={() => setConfirmDelete(true)}
                      aria-label="Delete"
                      title={isEn ? "Delete this entry" : "删除此百科"}
                      className="p-3 rounded-full bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 transition-all active:scale-95 flex items-center justify-center shadow-lg"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  )}
                  {/* 亮青色保存按钮 — 压缩/导入进行中一并禁用，
                      防止 coverFile 尚未就绪时提交导致图片被静默丢弃 */}
                  <button
                    onClick={commit}
                    disabled={saving || importing || isCompressingCover || isCompressingMaps || !!compressingExhibitId}
                    aria-label="Save"
                    title={isEn ? "Save" : "保存"}
                    className="p-3 rounded-full bg-brand hover:bg-brand/90 text-brand-foreground font-bold transition-all active:scale-95 flex items-center justify-center shadow-[0_0_20px_rgba(34,211,238,0.5)] disabled:opacity-50"
                  >
                    {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
                  </button>
                </>
              ) : (
                /* 浏览态：铅笔编辑按钮 — 进入编辑态并快照初始数据用于 isDirty 检测 */
                <button
                  onClick={enterEditMode}
                  aria-label="Edit Content"
                  title={isEn ? "Edit" : "编辑"}
                  className="p-2.5 rounded-full bg-brand/10 border border-brand/50 text-brand transition-all hover:bg-brand/20 flex items-center justify-center"
                >
                  <Pencil className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          {/* 标题输入栏 (调整至状态按钮下方、城市国家选择上方) */}
          <div className="px-5 py-3 sm:px-6">
            {/* 水平两端布局：左侧标题文本组，右侧地图定位按钮垂直居中（仅浏览态显示） */}
            <div className="flex justify-between items-center w-full">
              {/* 左侧：标题文本内容 */}
              <div className="flex flex-col gap-1 min-w-0 flex-1">
                <label className="text-[10px] font-bold text-brand tracking-wider uppercase">
                  {isEn ? "Name / Title" : "名称 / 标题"}
                </label>
                {editing ? (
                  <input
                    type="text"
                    value={draft.name}
                    onChange={(e) => updateField("name", e.target.value)}
                    placeholder={isEn ? "Enter museum or spot name..." : "输入博物馆或景点名称..."}
                    className="w-full bg-input border border-border/80 rounded-xl px-3 py-2 text-sm font-bold text-foreground focus:border-brand outline-none"
                  />
                ) : (
                  <h2 className="text-lg font-bold text-foreground">{draft.name}</h2>
                )}
                {/* 外文名称（副标题）— 编辑态：选填输入框（导入文档解析出的外文名称回显于此，可编辑/清空） */}
                {editing ? (
                  <>
                    <label className="text-[10px] font-bold text-brand/70 tracking-wider uppercase mt-1.5">
                      {isEn ? "Foreign Name / Subtitle (Optional)" : "外文名称 / 副标题（选填）"}
                    </label>
                    <input
                      type="text"
                      value={draft.nameCn ?? ""}
                      onChange={(e) => updateField("nameCn", e.target.value)}
                      placeholder={
                        isEn ? "e.g. Galleria dell'Accademia" : "如：Galleria dell'Accademia"
                      }
                      className="w-full bg-input border border-border/80 rounded-xl px-3 py-2 text-sm text-muted-foreground focus:border-brand outline-none"
                    />
                  </>
                ) : (
                  draft.nameCn ? (
                    <p className="text-xs text-muted-foreground">{draft.nameCn}</p>
                  ) : null
                )}
              </div>
              {/* 右侧：导航 + 地图定位双圆圈按钮组 — 浏览态显示，同一水平中轴线上
                  轴对称排版（w-9 h-9 = 原 p-2.5 + w-4 图标的实际视觉尺寸，保持不变）。
                  左：青色导航按钮（唤起多地图导航 ActionSheet）；
                  右：琥珀色定位 Pin 按钮（原有跳转地图定位逻辑）。 */}
              {!editing && museum && (
                <div className="ml-3 flex items-center gap-2 flex-shrink-0">
                  {/* 1. 导航按钮（排在左侧） */}
                  <button
                    type="button"
                    onClick={() => handleOpenNavigation(museum)}
                    aria-label="Navigate"
                    title={isEn ? "Navigate" : "一键导航"}
                    className="w-9 h-9 rounded-full flex items-center justify-center border border-teal-500/40 bg-teal-500/10 text-teal-400 hover:bg-teal-500/20 active:scale-95 transition-all shadow-sm"
                  >
                    <Navigation className="w-4 h-4" />
                  </button>

                  {/* 2. 现有的黄色定位 Pin 按钮（排在右侧）—— 无坐标时自动实时反算 */}
                  <button
                    onClick={handleLocateOnMap}
                    disabled={locatingOnMap}
                    aria-label="Locate on Map"
                    title={isEn ? "Locate on map" : "地图定位"}
                    className="w-9 h-9 shrink-0 rounded-full bg-amber-400/10 border border-amber-400/50 text-amber-500 transition-all hover:bg-amber-400/20 flex items-center justify-center disabled:opacity-60"
                  >
                    {locatingOnMap ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <MapPin className="w-4 h-4" />
                    )}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* 城市/国家选择器行 */}
          <div className="flex flex-wrap items-center gap-2 px-5 py-3 sm:px-6">
            {editing ? (
              /* 编辑态：城市 + 国家为点选选择器入口，点击唤起 LocationPickerModal */
              <>
                <button
                  type="button"
                  onClick={() => setPickerOpen("city")}
                  className="inline-flex items-center gap-1 rounded-full border border-brand/40 bg-card px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-brand transition hover:border-brand/70 hover:bg-brand/10"
                >
                  <MapPinned className="h-3 w-3" />
                  {draft.cityKey
                    ? getLocalizedCity(draft.cityKey, locale, draft.countryKey)
                    : t("encyclopedia.city")}
                  <ChevronDown className="h-3 w-3 opacity-60" />
                </button>
                <button
                  type="button"
                  onClick={() => setPickerOpen("country")}
                  className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-foreground transition hover:border-brand/40 hover:text-foreground"
                >
                  <Globe className="h-3 w-3" />
                  {draft.countryKey
                    ? getLocalizedCountry(draft.countryKey, locale)
                    : t("encyclopedia.country")}
                  <ChevronDown className="h-3 w-3 opacity-60" />
                </button>
              </>
            ) : (
              /* 浏览态：静态标签（调用本地化函数实现三端联动） */
              <>
                <span className="rounded-full bg-brand/15 px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-brand ring-1 ring-brand/30">
                  {getLocalizedCity(draft.cityKey, locale, draft.countryKey)}
                </span>
                <span className="rounded-full bg-muted px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground ring-1 ring-border">
                  {getLocalizedCountry(draft.countryKey, locale)}
                </span>
              </>
            )}
          </div>

          {/* Basic info */}
          <div className="grid gap-3 px-5 py-4 sm:grid-cols-2 sm:px-6">
            <InfoRow icon={<MapPin className="h-4 w-4 text-brand" />} label={t("encyclopedia.address")}>
              {editing ? (
                <div className="flex items-center gap-1.5">
                  <input
                    value={draft.address}
                    onChange={(e) => updateField("address", e.target.value)}
                    className={inputCls}
                  />
                  {/* 重新精准定位：按当前地址/名称手动触发三级建筑级地理编码 */}
                  <button
                    type="button"
                    title={locale === "en" ? "Re-locate" : "重新精准定位"}
                    disabled={locating}
                    onClick={handleRelocate}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-card text-brand shadow-sm transition-all hover:shadow-md disabled:opacity-50"
                  >
                    {locating ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <LocateFixed className="h-4 w-4" />
                    )}
                  </button>
                </div>
              ) : (
                <p className="text-sm text-foreground">{draft.address}</p>
              )}
            </InfoRow>
            <InfoRow icon={<Clock className="h-4 w-4 text-brand" />} label={t("encyclopedia.hours")}>
              {editing ? (
                <input
                  value={draft.hours}
                  onChange={(e) => updateField("hours", e.target.value)}
                  className={inputCls}
                />
              ) : (
                <p className="text-sm text-foreground">{draft.hours}</p>
              )}
            </InfoRow>
          </div>

          {/* Introduction — 浏览态下展品与导览图均隐藏时成为末尾板块，接管 pb-28 底部间距 */}
          <div
            className={`px-5 py-5 sm:px-6 ${
              !editing && mapsList.length === 0 && draft.exhibits.length === 0 ? "pb-28" : ""
            }`}
          >
            <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-brand">
              {t("encyclopedia.introduction")}
            </h3>
            {editing ? (
              <textarea
                value={draft.intro}
                onChange={(e) => updateField("intro", e.target.value)}
                rows={6}
                className={`${inputCls} mt-3`}
              />
            ) : (
              <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-foreground">
                {draft.intro}
              </p>
            )}
          </div>

          {/* Featured Masterpieces — 浏览态下展品为空时彻底隐藏整个板块（含蓝色分类标题），
              编辑态始终渲染以便增删展品；浏览态作为末尾板块时补 pb-28 底部安全间距 */}
          {(editing || draft.exhibits.length > 0) && (
          <div
            className={`px-5 py-5 sm:px-6 ${
              !editing && mapsList.length === 0 ? "pb-28" : ""
            }`}
          >
            <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-brand">
              {t("encyclopedia.featuredMasterpieces")}
            </h3>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {draft.exhibits.map((ex) => {
                const previewSrc = exhibitPreviews[ex.id] || ex.image;
                return (
                  <div
                    key={ex.id}
                    className="overflow-hidden rounded-xl border border-border bg-card transition-all"
                  >
                    {editing ? (
                      /* ========== 任务 1：编辑态 — 简化卡片 ==========
                         整张卡片为单一按钮，点击直接打开该展品的编辑弹窗。
                         移除卡片上冗余的编辑/删除小图标，保持卡片界面整洁。
                         删除操作移至展品编辑弹窗右下角（任务 3）。 */
                      <button
                        type="button"
                        onClick={() => openExhibitEditDialog(ex)}
                        className="flex w-full items-center gap-3 p-3 text-left hover:bg-muted/40 transition-colors cursor-pointer"
                      >
                        <div
                          className={`relative h-14 w-14 flex-shrink-0 rounded-lg overflow-hidden ring-1 ring-border ${
                            previewSrc ? "" : "bg-muted"
                          }`}
                        >
                          {previewSrc ? (
                            <PhotoImage
                              src={previewSrc}
                              alt={ex.name}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center">
                              <ImagePlus className="h-5 w-5 text-muted-foreground/50" />
                            </div>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-foreground">
                            {ex.name || (isEn ? "(Untitled)" : "(未命名)")}
                          </p>
                          {ex.nameCn && (
                            <p className="truncate text-[11px] text-muted-foreground">
                              {ex.nameCn}
                            </p>
                          )}
                        </div>
                        <Pencil className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                      </button>
                    ) : (
                      /* ========== 浏览态：整洁卡片，点击唤起居中大弹窗 ========== */
                      <button
                        type="button"
                        onClick={() => setExhibitModalId(ex.id)}
                        className="flex w-full items-center gap-3 p-3 text-left hover:bg-muted/40 transition-colors cursor-pointer"
                      >
                        <div
                          className={`relative h-14 w-14 flex-shrink-0 rounded-lg overflow-hidden ring-1 ring-border ${
                            previewSrc ? "" : "bg-muted"
                          }`}
                        >
                          {previewSrc ? (
                            <PhotoImage
                              src={previewSrc}
                              alt={ex.name}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center">
                              <ImagePlus className="h-5 w-5 text-muted-foreground/50" />
                            </div>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-foreground">
                            {ex.name}
                          </p>
                          {ex.nameCn && (
                            <p className="truncate text-[11px] text-muted-foreground">
                              {ex.nameCn}
                            </p>
                          )}
                        </div>
                        <ChevronDown className="h-4 w-4 flex-shrink-0 text-muted-foreground rotate-[-90deg]" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            {/* 任务 2：编辑态 — 底部"+ 新增核心展品"按钮 */}
            {editing && (
              <button
                onClick={() => openExhibitEditDialog(null)}
                className="mt-3 w-full flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border hover:border-brand/50 hover:bg-brand/5 py-3 text-sm text-muted-foreground hover:text-brand transition-all"
              >
                <Plus className="w-4 h-4" />
                <span>{isEn ? "Add Exhibit" : "新增核心展品"}</span>
              </button>
            )}
          </div>
          )}

          {/* ========== 高清导览图 (Guided Maps) 模块 ==========
              attachments JSONB 数组，支持多张高清场馆导览图（地图资料唯一入口）。
              - 编辑态：缩略图卡片（图片预览 + 标题输入 + 删除）+ 多选上传按钮（4096px/2MB 高清通道）
              - 浏览态：缩略图网格，点击打开支持手势缩放的全屏高清预览（不显示标题文本）
              - 排版：仅 1 张时卡片占满整行（grid-cols-1 + 更大预览高度）；
                2 张及以上时一行 2 个并排（grid-cols-2）
              - 浏览态空数组时彻底隐藏整个板块（含蓝色分类标题），已由外层条件保证 */}
          {(editing || mapsList.length > 0) && (
            <div className="px-5 py-5 pb-28 sm:px-6">
              <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-brand">
                {t("encyclopedia.guidedMaps")}
              </h3>

              <div
                className={`mt-3 grid gap-3 ${
                  mapsList.length === 1 ? "grid-cols-1" : "grid-cols-2"
                }`}
              >
                {mapsList.map((att) => (
                  <div
                    key={att.id}
                    className="overflow-hidden rounded-xl border border-border bg-card transition-all"
                  >
                    {editing ? (
                      /* 编辑态：图片预览 + 删除按钮 + 标题输入 */
                      <div className="relative">
                        <div
                          className={`relative w-full bg-muted/30 ${
                            mapsList.length === 1 ? "h-56" : "h-36"
                          }`}
                        >
                          <PhotoImage
                            src={att.url}
                            alt={att.title || t("encyclopedia.guidedMaps")}
                            className="h-full w-full object-cover"
                          />
                          <button
                            onClick={() => handleAttachmentDelete(att.id)}
                            aria-label={t("encyclopedia.deleteGuidedMap")}
                            title={t("encyclopedia.deleteGuidedMap")}
                            className="absolute top-2 right-2 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-red-500/80 hover:bg-red-500 text-white transition-all active:scale-95 backdrop-blur-md"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                        <input
                          type="text"
                          value={att.title}
                          onChange={(e) => updateAttachmentTitle(att.id, e.target.value)}
                          placeholder={t("encyclopedia.guidedMapTitlePlaceholder")}
                          className="w-full bg-input border-0 border-b border-border/80 rounded-none px-3 py-2 text-xs font-medium text-foreground placeholder:text-muted-foreground focus:border-brand outline-none"
                        />
                      </div>
                    ) : (
                      /* 浏览态：纯净图片缩略图卡片（不显示标题文本），
                         点击打开手势缩放高清预览 */
                      <button
                        type="button"
                        onClick={() => setMapLightboxSrc(att.url)}
                        className="w-full text-left cursor-pointer group"
                      >
                        <div
                          className={`relative w-full bg-muted/30 ${
                            mapsList.length === 1 ? "h-56" : "h-36"
                          }`}
                        >
                          <PhotoImage
                            src={att.url}
                            alt={att.title || t("encyclopedia.guidedMaps")}
                            className="h-full w-full object-cover group-hover:opacity-90 transition-opacity"
                          />
                          <div className="absolute bottom-2 right-2 bg-black/60 backdrop-blur-md text-white/80 rounded-full p-1.5">
                            <ZoomIn className="w-4 h-4" />
                          </div>
                        </div>
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {/* 编辑态：多选添加导览图按钮（压缩期间禁用并显示进度指示） */}
              {editing && (
                <button
                  onClick={() => mapsInputRef.current?.click()}
                  disabled={isCompressingMaps}
                  className="mt-3 w-full flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border hover:border-brand/50 hover:bg-brand/5 py-3 text-sm text-muted-foreground hover:text-brand transition-all disabled:opacity-60"
                >
                  {isCompressingMaps ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>{isEn ? "Processing high-res maps..." : "高清导览图处理中..."}</span>
                    </>
                  ) : (
                    <>
                      <Plus className="w-4 h-4" />
                      <span>{t("encyclopedia.addGuidedMap")}</span>
                    </>
                  )}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Location Picker Modal：点选式国家/城市搜索选择器 — 通过 Portal 渲染到 body，
          避免父级 Modal 的 transform/overflow-hidden 导致裁切锁死 */}
      {pickerOpen && draft &&
        createPortal(
          <LocationPickerModal
            mode={pickerOpen}
            locale={locale}
            currentCountryKey={draft.countryKey}
            currentCityKey={draft.cityKey}
            onPick={handlePick}
            onClose={() => setPickerOpen(null)}
          />,
          document.body,
        )}

      {/* 删除确认弹窗 — 通过 Portal 渲染到 body，确保层级最高 */}
      {confirmDelete &&
        createPortal(
          <div
            className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
            onClick={() => !deleting && setConfirmDelete(false)}
          >
            <div
              className="w-full max-w-sm rounded-2xl border border-rose-500/30 bg-card p-6 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex flex-col items-center gap-3 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-rose-500/15 ring-1 ring-rose-500/40">
                  <AlertTriangle className="h-6 w-6 text-rose-400" />
                </div>
                <h3 className="text-base font-bold text-foreground">
                  {isEn ? "Delete this entry?" : "确认删除此百科？"}
                </h3>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {isEn
                    ? "This will permanently remove the entry and all its exhibits. This action cannot be undone."
                    : "将永久删除该百科卡片及其所有展品信息，此操作不可撤销。"}
                </p>
                <div className="mt-2 flex w-full gap-2">
                  <button
                    onClick={() => setConfirmDelete(false)}
                    disabled={deleting}
                    className="flex-1 rounded-xl bg-muted py-2.5 text-sm font-semibold text-foreground transition hover:bg-muted/80 disabled:opacity-50"
                  >
                    {isEn ? "Cancel" : "取消"}
                  </button>
                  <button
                    onClick={handleDelete}
                    disabled={deleting}
                    className="flex-1 rounded-xl bg-rose-500 py-2.5 text-sm font-bold text-white transition hover:bg-rose-600 disabled:opacity-50"
                  >
                    {deleting
                      ? isEn ? "Deleting..." : "删除中..."
                      : isEn ? "Delete" : "确认删除"}
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {/* ========== 任务 4：未保存修改警告弹窗（替换原生 window.confirm）==========
          三处自定义确认弹窗，复用 confirmDelete 的 Portal + 深色主题 UI 模式：
          - confirmExhibitDiscard：展品编辑弹窗未保存拦截（z-[100] 高于展品编辑弹窗 z-[95]）
          - confirmExhibitDelete：展品编辑弹窗内删除二次确认（z-[100]）
          - confirmMuseumDiscard：主弹窗未保存拦截（z-[80] 与 confirmDelete 同层）

          状态逻辑：
          - 点击【取消/Cancel】仅关闭警告弹窗，保留底层表单及已输入数据（不触发卸载）
          - 点击【确认放弃/Discard】关闭警告弹窗 + 清空状态 + 关闭底层表单
      */}
      {confirmExhibitDiscard &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
            onClick={() => setConfirmExhibitDiscard(false)}
          >
            <div
              className="w-full max-w-sm rounded-2xl border border-amber-500/30 bg-card p-6 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex flex-col items-center gap-3 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/15 ring-1 ring-amber-500/40">
                  <AlertTriangle className="h-6 w-6 text-amber-400" />
                </div>
                <h3 className="text-base font-bold text-foreground">
                  {isEn ? "Unsaved Changes" : "有未保存的修改"}
                </h3>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {isEn
                    ? "You have unsaved changes to this exhibit. Discard them and close?"
                    : "该展品有未保存的修改，确定放弃并关闭吗？"}
                </p>
                <div className="mt-2 flex w-full gap-2">
                  <button
                    onClick={() => setConfirmExhibitDiscard(false)}
                    className="flex-1 rounded-xl bg-muted py-2.5 text-sm font-semibold text-foreground transition hover:bg-muted/80"
                  >
                    {isEn ? "Cancel" : "取消"}
                  </button>
                  <button
                    onClick={confirmDiscardExhibitEdit}
                    className="flex-1 rounded-xl bg-amber-500 py-2.5 text-sm font-bold text-white transition hover:bg-amber-600"
                  >
                    {isEn ? "Discard" : "确认放弃"}
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {confirmExhibitDelete &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
            onClick={() => setConfirmExhibitDelete(false)}
          >
            <div
              className="w-full max-w-sm rounded-2xl border border-rose-500/30 bg-card p-6 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex flex-col items-center gap-3 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-rose-500/15 ring-1 ring-rose-500/40">
                  <AlertTriangle className="h-6 w-6 text-rose-400" />
                </div>
                <h3 className="text-base font-bold text-foreground">
                  {isEn ? "Delete this exhibit?" : "确认删除此展品？"}
                </h3>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {isEn
                    ? "This exhibit will be removed from the museum. This action cannot be undone."
                    : "将从百科卡片中移除该展品，此操作不可撤销。"}
                </p>
                <div className="mt-2 flex w-full gap-2">
                  <button
                    onClick={() => setConfirmExhibitDelete(false)}
                    className="flex-1 rounded-xl bg-muted py-2.5 text-sm font-semibold text-foreground transition hover:bg-muted/80"
                  >
                    {isEn ? "Cancel" : "取消"}
                  </button>
                  <button
                    onClick={confirmDeleteExhibitFromDialog}
                    className="flex-1 rounded-xl bg-rose-500 py-2.5 text-sm font-bold text-white transition hover:bg-rose-600"
                  >
                    {isEn ? "Delete" : "确认删除"}
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {confirmMuseumDiscard &&
        createPortal(
          <div
            className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
            onClick={() => setConfirmMuseumDiscard(false)}
          >
            <div
              className="w-full max-w-sm rounded-2xl border border-amber-500/30 bg-card p-6 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex flex-col items-center gap-3 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/15 ring-1 ring-amber-500/40">
                  <AlertTriangle className="h-6 w-6 text-amber-400" />
                </div>
                <h3 className="text-base font-bold text-foreground">
                  {isEn ? "Unsaved Changes" : "有未保存的修改"}
                </h3>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {isEn
                    ? "You have unsaved changes to this entry. Discard them and exit?"
                    : "该百科有未保存的修改，确定放弃并退出吗？"}
                </p>
                <div className="mt-2 flex w-full gap-2">
                  <button
                    onClick={() => setConfirmMuseumDiscard(false)}
                    className="flex-1 rounded-xl bg-muted py-2.5 text-sm font-semibold text-foreground transition hover:bg-muted/80"
                  >
                    {isEn ? "Cancel" : "取消"}
                  </button>
                  <button
                    onClick={confirmDiscardMuseumEdit}
                    className="flex-1 rounded-xl bg-amber-500 py-2.5 text-sm font-bold text-white transition hover:bg-amber-600"
                  >
                    {isEn ? "Discard" : "确认放弃"}
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {/* ========== 任务 1：展品详情居中大弹窗（浏览态）==========
          点击展品卡片唤起，从上到下依次展示：展品大图（可点击放大）、
          标题、作品简介 (background)、历史故事 (story)。
          内容过长支持内部滚动 (overflow-y-auto)，padding 充足，阅读体验舒适。
          通过 Portal 渲染到 body，z-[90] 低于 lightbox (z-[99999]) 但高于父弹窗。 */}
      {exhibitModalId &&
        draft &&
        (() => {
          const ex = draft.exhibits.find((e) => e.id === exhibitModalId);
          if (!ex) return null;
          const previewSrc = ex.image;
          return createPortal(
            <div
              className="fixed inset-0 z-[90] flex items-center justify-center bg-black/80 backdrop-blur-sm p-3 sm:p-6 animate-in fade-in duration-200"
              onClick={() => setExhibitModalId(null)}
            >
              <div
                className="relative w-full max-w-2xl max-h-[85vh] bg-card border border-border rounded-3xl flex flex-col overflow-hidden shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              >
                {/* 关闭按钮 */}
                <button
                  onClick={() => setExhibitModalId(null)}
                  aria-label="Close"
                  className="absolute top-3 right-3 z-30 bg-black/60 hover:bg-black/80 text-white rounded-full p-2 backdrop-blur-md transition"
                >
                  <X className="h-4 w-4" />
                </button>

                {/* 可滚动主体 */}
                <div className="flex-1 overflow-y-auto overscroll-contain [-webkit-overflow-scrolling:touch]">
                  {/* 展品大图：点击放大全屏预览（保留之前做好的点击图片放大功能） */}
                  {previewSrc && (
                    <div
                      onClick={() => setLightboxSrc(previewSrc)}
                      className="relative w-full h-64 sm:h-72 overflow-hidden bg-muted cursor-pointer group"
                    >
                      <PhotoImage
                        src={previewSrc}
                        alt={ex.name}
                        eager
                        className="w-full h-full object-cover group-hover:opacity-90 transition-opacity"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-card via-card/40 to-transparent pointer-events-none" />
                      {/* 悬浮放大提示 */}
                      <div className="absolute bottom-3 right-3 flex items-center gap-1.5 text-brand text-xs font-semibold bg-black/50 px-2.5 py-1.5 rounded-full backdrop-blur-md">
                        <ZoomIn className="h-3.5 w-3.5" />
                        <span>{isEn ? "Zoom" : "放大"}</span>
                      </div>
                    </div>
                  )}

                  {/* 文字内容区：充足内边距，长文阅读舒适 */}
                  <div className="px-6 py-5 space-y-5">
                    {/* 标题 */}
                    <div>
                      <h2 className="text-xl font-bold text-foreground leading-tight">
                        {ex.name}
                      </h2>
                      {ex.nameCn && (
                        <p className="mt-1 text-sm text-muted-foreground">
                          {ex.nameCn}
                        </p>
                      )}
                    </div>

                    {/* 任务 3：第一项 — 作品简介 (background) */}
                    {ex.background && (
                      <div>
                        <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-brand/80 mb-2">
                          {t("encyclopedia.worksIntro")}
                        </p>
                        {/* 任务 2：whitespace-pre-wrap 保留用户输入的换行分段 */}
                        <p className="text-sm leading-relaxed text-foreground/90 whitespace-pre-wrap">
                          {ex.background}
                        </p>
                      </div>
                    )}

                    {/* 任务 3：第二项 — 历史故事 (story) */}
                    {ex.story && (
                      <div>
                        <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-amber-400/80 mb-2">
                          {t("encyclopedia.historicalStory")}
                        </p>
                        {/* 任务 2：whitespace-pre-wrap 保留用户输入的换行分段 */}
                        <p className="text-sm leading-relaxed text-foreground/90 whitespace-pre-wrap">
                          {ex.story}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>,
            document.body,
          );
        })()}

      {/* 全屏大图预览灯箱 — 支持 Pinch-to-Zoom / Pan / 双击缩放
          通过 Portal 渲染到 body 确保层级最高；所有事件 stopPropagation
          防止冒泡关闭底层 MuseumDetail / 展品详情弹窗 */}
      {lightboxSrc &&
        createPortal(
          <ZoomableLightbox
            src={lightboxSrc}
            alt={isEn ? "Image full preview" : "图片大图预览"}
            isEn={isEn}
            onClose={() => setLightboxSrc(null)}
          />,
          document.body,
        )}

      {/* 高清导览图全屏预览灯箱 — 复用 ZoomableLightbox 手势缩放能力，
          但走 getHighResImageUrl 高清通道（无宽度限制 + q=95），
          确保放大后地图文字（房间号/导览标注）绝对清晰。
          关闭本预览不影响底层百科详情弹窗 */}
      {mapLightboxSrc &&
        createPortal(
          <ZoomableLightbox
            src={mapLightboxSrc}
            alt={isEn ? "Guided map preview" : "导览图大图预览"}
            isEn={isEn}
            highRes
            onClose={() => setMapLightboxSrc(null)}
          />,
          document.body,
        )}

      {/* 多地图导航 ActionSheet — 视觉与 RestaurantDetailModal / 地图模块导航选择弹窗一致，
          提供 Google Maps / Apple Maps / 高德 / 百度 四选项，点击唤醒对应地图 App 导航。
          通过 Portal 渲染到 body，z-[1300] 高于父弹窗。 */}
      {mapSheetOpen &&
        createPortal(
          <div
            className="fixed inset-0 z-[1300] flex animate-in fade-in duration-200 items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-4"
            onClick={() => setMapSheetOpen(false)}
          >
            <div
              className="relative w-full max-w-lg rounded-t-3xl border border-border/60 bg-card p-0 shadow-2xl animate-in slide-in-from-bottom duration-300 sm:rounded-3xl"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => setMapSheetOpen(false)}
                aria-label="Close"
                className="absolute right-4 top-4 rounded-full bg-muted p-1.5 text-muted-foreground transition-all hover:text-foreground active:scale-95"
              >
                <X className="h-4 w-4" />
              </button>
              <div className="px-5 pt-4">
                <h3 className="text-base font-semibold text-foreground">{t("nav.chooseMap")}</h3>
              </div>
              <div className="mx-auto w-full max-w-lg space-y-2 px-5 pb-6 pt-3">
                {navLinks.map((link) => (
                  <a
                    key={link.labelKey}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setMapSheetOpen(false)}
                    className="flex items-center justify-between rounded-xl border border-border/50 bg-muted/30 px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-muted/50 active:scale-[0.99]"
                  >
                    {t(link.labelKey)}
                    <ExternalLink className="h-4 w-4 text-muted-foreground" />
                  </a>
                ))}
              </div>
            </div>
          </div>,
          document.body,
        )}

      {/* ========== 任务 2/3/4：展品编辑弹窗（编辑态）==========
          点击展品卡片或"+ 新增核心展品"按钮唤起。
          独立居中大弹窗，提供宽敞的填写空间：
          展品图片上传 + 英文名称 + 中文名称 + 作品简介(4行) + 历史故事(6行)。
          - 任务 2：移除左上角标题，保留右上角 X 关闭按钮，视觉开阔
          - 任务 3：右下角图标按钮（Trash2 删除 + Save 保存），无文字
          - 任务 4：X 按钮与背景遮罩点击触发 closeExhibitEditWithConfirm，
                    有未保存修改时弹窗二次确认防误触
          通过 Portal 渲染到 body，z-[95] 高于父弹窗(z-50) 但低于 lightbox(z-99999)。 */}
      {exhibitEditId && exhibitEditDraft && editing && draft &&
        (() => {
          // 判断当前是否为编辑现有展品（用于决定是否显示删除按钮）
          const isExistingExhibit = draft.exhibits.some((e) => e.id === exhibitEditId);
          return createPortal(
            <div
              className="fixed inset-0 z-[95] flex items-center justify-center bg-black/80 backdrop-blur-sm p-3 sm:p-6 animate-in fade-in duration-200"
              onClick={closeExhibitEditWithConfirm}
            >
              <div
                className="relative w-full max-w-2xl max-h-[85vh] bg-card border border-border rounded-3xl flex flex-col overflow-hidden shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              >
                {/* 任务 2：右上角 X 关闭按钮（带未保存修改确认，任务 4） */}
                <button
                  onClick={closeExhibitEditWithConfirm}
                  aria-label="Close"
                  className="absolute top-3 right-3 z-30 bg-black/60 hover:bg-black/80 text-white rounded-full p-2 backdrop-blur-md transition"
                >
                  <X className="h-4 w-4" />
                </button>

                {/* 隐藏的文件选择框 */}
                <input
                  type="file"
                  ref={exhibitEditFileInputRef}
                  onChange={handleExhibitEditImageChange}
                  accept="image/*"
                  className="hidden"
                />

                {/* 可滚动主体 — 任务 2：移除标题文字，顶部留出充足内边距 */}
                <div className="flex-1 overflow-y-auto overscroll-contain [-webkit-overflow-scrolling:touch]">
                  <div className="px-6 pt-8 pb-6 space-y-5">
                    {/* 展品图片：点击上传/更换，不显示 URL 文本框 */}
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-brand/80 mb-2">
                        {isEn ? "Exhibit Image" : "展品图片"}
                      </p>
                      <div
                        onClick={handleExhibitEditImageClick}
                        className="relative w-full h-40 rounded-xl overflow-hidden border-2 border-dashed border-border hover:border-brand/50 transition-colors cursor-pointer group bg-muted/30"
                      >
                        {exhibitEditDraft.image ? (
                          <>
                            <PhotoImage
                              src={exhibitEditDraft.image}
                              alt={exhibitEditDraft.name || "Exhibit"}
                              eager
                              className="w-full h-full object-cover"
                            />
                            <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2 text-brand font-semibold text-sm">
                              <Camera className="w-5 h-5" />
                              <span>{isEn ? "Change Image" : "更换图片"}</span>
                            </div>
                          </>
                        ) : (
                          <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-muted-foreground group-hover:text-brand transition-colors">
                            <ImagePlus className="w-8 h-8" />
                            <span className="text-xs">{isEn ? "Click to upload image" : "点击上传展品图片"}</span>
                          </div>
                        )}
                        {compressingExhibitId === exhibitEditId && (
                          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center">
                            <Loader2 className="w-6 h-6 text-brand animate-spin" />
                          </div>
                        )}
                      </div>
                    </div>

                    {/* 展品名称（主标题 — 中文优先） */}
                    <div>
                      <label className="text-[10px] font-semibold uppercase tracking-wider text-brand/80 mb-1.5 block">
                        {isEn ? "Name / Title" : "展品名称 / 标题"}
                      </label>
                      <input
                        type="text"
                        value={exhibitEditDraft.name}
                        onChange={(e) => updateExhibitDraftField("name", e.target.value)}
                        placeholder={t("encyclopedia.exhibitNamePlaceholder")}
                        className={inputCls}
                      />
                    </div>

                    {/* 外文名称（副标题） */}
                    <div>
                      <label className="text-[10px] font-semibold uppercase tracking-wider text-brand/80 mb-1.5 block">
                        {isEn ? "Foreign Name (Subtitle)" : "外文名称（副标题）"}
                      </label>
                      <input
                        type="text"
                        value={exhibitEditDraft.nameCn ?? ""}
                        onChange={(e) => updateExhibitDraftField("nameCn", e.target.value)}
                        placeholder={t("encyclopedia.exhibitNameCnPlaceholder")}
                        className={inputCls}
                      />
                    </div>

                    {/* 作品简介 — 多行大文本框，至少 4 行高 */}
                    <div>
                      <label className="text-[10px] font-semibold uppercase tracking-wider text-brand/80 mb-1.5 block">
                        {t("encyclopedia.worksIntro")}
                      </label>
                      <textarea
                        value={exhibitEditDraft.background}
                        onChange={(e) => updateExhibitDraftField("background", e.target.value)}
                        rows={4}
                        placeholder={isEn ? "Enter a brief introduction..." : "输入作品简介..."}
                        className={`${inputCls} resize-y min-h-[100px]`}
                      />
                    </div>

                    {/* 历史故事 — 多行大文本框，至少 6 行高 */}
                    <div>
                      <label className="text-[10px] font-semibold uppercase tracking-wider text-amber-400/80 mb-1.5 block">
                        {t("encyclopedia.historicalStory")}
                      </label>
                      <textarea
                        value={exhibitEditDraft.story}
                        onChange={(e) => updateExhibitDraftField("story", e.target.value)}
                        rows={6}
                        placeholder={isEn ? "Enter the historical story..." : "输入历史故事..."}
                        className={`${inputCls} resize-y min-h-[150px]`}
                      />
                    </div>
                  </div>
                </div>

                {/* 任务 3：底部右下角图标按钮栏 — 仅图标无文字，对齐其他弹窗风格
                    - 删除按钮（仅编辑现有展品时显示，新增模式不显示）
                    - 保存按钮（高亮主题色） */}
                <div className="flex justify-end items-center gap-3 border-t border-border px-6 py-4 bg-card shrink-0">
                  {isExistingExhibit && (
                    <button
                      onClick={deleteCurrentExhibitFromDialog}
                      aria-label={t("common.delete")}
                      title={isEn ? "Delete exhibit" : "删除展品"}
                      className="flex h-10 w-10 items-center justify-center rounded-full bg-red-500/10 ring-1 ring-red-500/30 text-red-400 transition-all hover:bg-red-500/20 active:scale-95"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                  <button
                    onClick={saveExhibitFromDialog}
                    aria-label={t("common.save")}
                    title={isEn ? "Save exhibit" : "保存展品"}
                    className="flex h-10 w-10 items-center justify-center rounded-full bg-brand text-brand-foreground transition-all hover:bg-brand/90 active:scale-95 shadow-[0_0_14px_rgba(0,242,254,0.4)]"
                  >
                    <Save className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          );
        })()}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// ZoomableLightbox — 全屏图片预览组件，支持手势缩放与拖拽
// ─────────────────────────────────────────────────────────────────────────
// 交互逻辑：
// - Pinch-to-Zoom：双指捏合放大/缩小（1x–5x）
// - Double-tap / Double-click：双击切换 1x ↔ 2.5x
// - Pan：放大后单指拖拽 / 鼠标拖拽移动图片
// - Mouse Wheel：桌面端滚轮缩放
// - 关闭：单击/单指点击 300ms 后关闭（双击会取消关闭并缩放）
// - 所有事件 stopPropagation 防止冒泡关闭底层 MuseumDetail 弹窗
// ─────────────────────────────────────────────────────────────────────────
function ZoomableLightbox({
  src,
  alt,
  isEn,
  onClose,
  highRes = false,
}: {
  src: string;
  alt: string;
  isEn: boolean;
  onClose: () => void;
  /** 高清导览图模式：走 getHighResImageUrl（无宽度限制 + q=95），保留地图文字锐度 */
  highRes?: boolean;
}) {
  // 解析图片 URL：兼容 Storage 路径（自动签名）/ http URL / blob / data URL
  const resolvedUrl = usePhotoUrl(src);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  // 手势状态 ref — 避免频繁 re-render，touchmove 中直接读写
  const g = useRef({
    mode: "idle" as "idle" | "pan" | "pinch",
    startDist: 0,
    startZoom: 1,
    startPanX: 0,
    startPanY: 0,
    touchX: 0,
    touchY: 0,
    lastTap: 0,
    moved: false,
  });
  // 延迟关闭计时器 — 单击后等待 300ms，若期间发生双击则取消关闭
  const closeTimer = useRef<number | null>(null);
  // 记录最后一次 touchend 时间，用于过滤 touch 合成的 click 事件
  const lastTouchEnd = useRef(0);
  // 标记鼠标拖拽是否发生过移动，防止拖拽后误触发关闭
  const mouseDragged = useRef(false);

  // 组件卸载时清理计时器
  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

  const resetZoom = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  // 计算两指间直线距离
  const pinchDist = (a: React.Touch, b: React.Touch) =>
    Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);

  // ==================== Touch 手势 ====================
  const onTouchStart = (e: React.TouchEvent) => {
    e.stopPropagation();
    // 新一轮手势开始，取消待关闭计时
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    if (e.touches.length === 2) {
      // 双指 → 进入缩放模式，记录起始距离和当前缩放倍率
      g.current.mode = "pinch";
      g.current.startDist = pinchDist(e.touches[0], e.touches[1]);
      g.current.startZoom = zoom;
      g.current.moved = true; // 双指操作不触发 tap 关闭
    } else if (e.touches.length === 1) {
      const t = e.touches[0];
      if (zoom > 1) {
        // 已放大 → 进入拖拽模式，记录起始坐标
        g.current.mode = "pan";
        g.current.startPanX = pan.x;
        g.current.startPanY = pan.y;
        g.current.touchX = t.clientX;
        g.current.touchY = t.clientY;
      } else {
        g.current.mode = "idle";
      }
      g.current.moved = false;
    }
  };

  const onTouchMove = (e: React.TouchEvent) => {
    e.stopPropagation();
    if (g.current.mode === "pinch" && e.touches.length === 2) {
      e.preventDefault();
      const d = pinchDist(e.touches[0], e.touches[1]);
      const ratio = d / Math.max(1, g.current.startDist);
      const z = Math.max(1, Math.min(5, g.current.startZoom * ratio));
      setZoom(z);
      if (z === 1) setPan({ x: 0, y: 0 });
      g.current.moved = true;
    } else if (g.current.mode === "pan" && e.touches.length === 1) {
      e.preventDefault();
      const t = e.touches[0];
      const dx = t.clientX - g.current.touchX;
      const dy = t.clientY - g.current.touchY;
      // 移动超过 4px 才标记为 moved，避免手指微抖误判
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) g.current.moved = true;
      setPan({ x: g.current.startPanX + dx, y: g.current.startPanY + dy });
    }
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    e.stopPropagation();
    lastTouchEnd.current = Date.now();
    // 仍有手指在屏上（从双指变单指）→ 切换到 pan 模式继续拖拽
    if (e.touches.length > 0) {
      if (e.touches.length === 1) {
        const t = e.touches[0];
        g.current.mode = zoom > 1 ? "pan" : "idle";
        g.current.touchX = t.clientX;
        g.current.touchY = t.clientY;
        g.current.startPanX = pan.x;
        g.current.startPanY = pan.y;
      }
      return;
    }
    // 所有手指离开
    g.current.mode = "idle";
    // 缩放/拖拽手势结束，不触发 tap 关闭
    if (g.current.moved) {
      g.current.moved = false;
      return;
    }
    // Tap 检测 — 300ms 内第二次 tap 为双击缩放，否则单击延迟关闭
    const now = Date.now();
    if (now - g.current.lastTap < 300) {
      // 双击 → 切换缩放
      if (zoom > 1) resetZoom();
      else setZoom(2.5);
      g.current.lastTap = 0;
    } else {
      g.current.lastTap = now;
      closeTimer.current = window.setTimeout(() => {
        closeTimer.current = null;
        onClose();
      }, 300);
    }
  };

  // ==================== Mouse 桌面端 ====================
  const onWheel = (e: React.WheelEvent) => {
    e.stopPropagation();
    const factor = e.deltaY > 0 ? 1 / 1.15 : 1.15;
    setZoom((z) => {
      const nz = Math.max(1, Math.min(5, z * factor));
      if (nz === 1) setPan({ x: 0, y: 0 });
      return nz;
    });
  };

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (zoom <= 1) return; // 未放大时不启用鼠标拖拽
    mouseDragged.current = false;
    const sx = e.clientX;
    const sy = e.clientY;
    const spx = pan.x;
    const spy = pan.y;
    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - sx;
      const dy = ev.clientY - sy;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) mouseDragged.current = true;
      setPan({ x: spx + dx, y: spy + dy });
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    // 取消单击关闭计时，执行双击缩放
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    if (zoom > 1) resetZoom();
    else setZoom(2.5);
  };

  const onClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    // 忽略 Touch 产生的合成 click（已在 touchend 中处理关闭/缩放）
    if (Date.now() - lastTouchEnd.current < 500) return;
    // 忽略拖拽后的 click
    if (mouseDragged.current) {
      mouseDragged.current = false;
      return;
    }
    // 延迟关闭 300ms，为双击缩放留出窗口（dblclick 会取消此计时）
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      onClose();
    }, 300);
  };

  // 高清导览图走无宽度限制通道；普通图片走 800px 压缩通道节省流量
  const imgUrl = resolvedUrl
    ? highRes
      ? getHighResImageUrl(resolvedUrl)
      : getOptimizedImageUrl(resolvedUrl)
    : undefined;
  const isGesturing = g.current.mode !== "idle";

  return (
    <div
      className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/95 backdrop-blur-md p-2 animate-in fade-in duration-200 overflow-hidden select-none"
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onWheel={onWheel}
      onMouseDown={onMouseDown}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      style={{ touchAction: "none" }}
    >
      {imgUrl ? (
        <img
          src={imgUrl}
          alt={alt}
          draggable={false}
          className="max-w-full max-h-full object-contain rounded-lg pointer-events-none"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transition: isGesturing ? "none" : "transform 0.25s ease-out",
            willChange: "transform",
          }}
        />
      ) : (
        <Loader2 className="w-8 h-8 text-brand animate-spin" />
      )}
      {/* 右上角轻量提示文案，替代传统顶栏关闭键，避免冲出屏幕顶端点击不到 */}
      <div className="absolute top-5 right-5 text-white/70 text-xs bg-card/80 px-3 py-1.5 rounded-full border border-border pointer-events-none">
        {isEn ? "Pinch to zoom · Tap to exit" : "双指缩放 · 点击退出"}
      </div>
      {/* 缩放倍率指示器 — 放大时显示 */}
      {zoom > 1 && (
        <div className="absolute bottom-5 left-1/2 -translate-x-1/2 text-white/70 text-xs bg-card/80 px-3 py-1.5 rounded-full border border-border pointer-events-none">
          {Math.round(zoom * 100)}%
        </div>
      )}
    </div>
  );
}

function InfoRow({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// LocationPickerModal：点选式国家/城市搜索选择器
// ─────────────────────────────────────────────────────────────────────────
// - mode === "country"：展示全球国家列表，搜索框支持按 key/zh/en 实时过滤
// - mode === "city"：展示当前 countryKey 下的城市列表；若未选国家则展示全局扁平列表
// - 用户点选后，通过 onPick 回调：
//     country 模式 → onPick(countryKey)
//     city 模式    → onPick(`${countryKey}:${cityKey}`) 复合 key
//   父组件 handlePick 会解析并同步更新 countryKey/cityKey，保证一致性。
// ─────────────────────────────────────────────────────────────────────────

interface PickerProps {
  mode: "country" | "city";
  locale: Locale;
  currentCountryKey: string;
  currentCityKey: string;
  onPick: (key: string) => void;
  onClose: () => void;
}

/** 点选式国家/城市搜索选择器 — 导出供酒店等其他模块复用 */
export function LocationPickerModal({
  mode,
  locale,
  currentCountryKey,
  currentCityKey,
  onPick,
  onClose,
}: PickerProps) {
  const t = useT();
  const [query, setQuery] = useState("");

  // 国家列表（带搜索过滤）
  const countryList = useMemo<CountryEntry[]>(() => {
    const all = getAllCountries();
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (c) =>
        c.key.includes(q) ||
        c.en.toLowerCase().includes(q) ||
        c.zh.includes(query.trim()),
    );
  }, [query]);

  // 城市列表：优先取当前国家下的城市，无国家时取全局扁平列表
  const cityList = useMemo<Array<CityEntry & { countryKey: string; countryZh: string; countryEn: string }>>(() => {
    const all = getAllCountries();
    const flat: Array<CityEntry & { countryKey: string; countryZh: string; countryEn: string }> = [];
    for (const c of all) {
      for (const city of c.cities) {
        flat.push({ ...city, countryKey: c.key, countryZh: c.zh, countryEn: c.en });
      }
    }
    const scoped = currentCountryKey
      ? flat.filter((c) => c.countryKey === currentCountryKey)
      : flat;
    const q = query.trim().toLowerCase();
    if (!q) return scoped;
    return scoped.filter(
      (c) =>
        c.key.includes(q) ||
        c.en.toLowerCase().includes(q) ||
        c.zh.includes(query.trim()),
    );
  }, [query, currentCountryKey]);

  const isCountryMode = mode === "country";

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-lg max-h-[70vh] flex flex-col overflow-hidden rounded-3xl border border-brand/30 bg-card shadow-[0_0_60px_rgba(0,191,165,0.25)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div className="flex items-center gap-2">
            {isCountryMode ? (
              <Globe className="h-4 w-4 text-brand" />
            ) : (
              <MapPinned className="h-4 w-4 text-brand" />
            )}
            <h3 className="text-sm font-semibold uppercase tracking-wider text-brand">
              {isCountryMode ? t("encyclopedia.country") : t("encyclopedia.city")}
            </h3>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-full bg-black/50 p-1.5 text-foreground ring-1 ring-border transition hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Search */}
        <div className="border-b border-border px-4 py-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={
                isCountryMode
                  ? t("encyclopedia.pickerSearchCountry")
                  : t("encyclopedia.pickerSearchCity")
              }
              className="w-full rounded-full border border-border bg-input py-2 pl-9 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:border-brand/50 focus:outline-none focus:ring-2 focus:ring-brand/25"
            />
          </div>
        </div>

        {/* List — 可流畅滚动的城市/国家列表 */}
        <div className="flex-1 overflow-y-auto overscroll-contain [-webkit-overflow-scrolling:touch] px-2 py-2">
          {isCountryMode
            ? countryList.map((c) => {
                const active = c.key === currentCountryKey;
                return (
                  <button
                    key={c.key}
                    onClick={() => onPick(c.key)}
                    className={`flex w-full items-center justify-between rounded-xl px-4 py-2.5 text-left text-sm transition ${
                      active
                        ? "bg-brand/15 text-brand ring-1 ring-brand/40"
                        : "text-foreground hover:bg-foreground/5"
                    }`}
                  >
                    <span>{locale === "zh" ? c.zh : c.en}</span>
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      {locale === "zh" ? c.en : c.zh}
                    </span>
                  </button>
                );
              })
            : cityList.map((c) => {
                const active = c.key === currentCityKey && c.countryKey === currentCountryKey;
                return (
                  <button
                    key={`${c.countryKey}:${c.key}`}
                    onClick={() => onPick(`${c.countryKey}:${c.key}`)}
                    className={`flex w-full items-center justify-between rounded-xl px-4 py-2.5 text-left text-sm transition ${
                      active
                        ? "bg-brand/15 text-brand ring-1 ring-brand/40"
                        : "text-foreground hover:bg-foreground/5"
                    }`}
                  >
                    <span>{locale === "zh" ? c.zh : c.en}</span>
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      {locale === "zh" ? c.countryZh : c.countryEn}
                    </span>
                  </button>
                );
              })}

          {/* 自定义输入选项：搜索词未命中预设词库时，允许用户直接使用自定义名称 */}
          {query.trim() && !isCountryMode && cityList.length === 0 && (
            <button
              onClick={() => onPick(query.trim())}
              className="flex w-full items-center gap-2 rounded-xl px-4 py-2.5 text-left text-sm text-brand transition hover:bg-brand/10"
            >
              <MapPinned className="h-4 w-4 shrink-0" />
              <span>
                {locale === "zh" ? "使用自定义城市：" : "Use custom city: "}
                <span className="font-semibold">{query.trim()}</span>
              </span>
            </button>
          )}
          {query.trim() && isCountryMode && countryList.length === 0 && (
            <button
              onClick={() => onPick(query.trim())}
              className="flex w-full items-center gap-2 rounded-xl px-4 py-2.5 text-left text-sm text-brand transition hover:bg-brand/10"
            >
              <Globe className="h-4 w-4 shrink-0" />
              <span>
                {locale === "zh" ? "使用自定义国家：" : "Use custom country: "}
                <span className="font-semibold">{query.trim()}</span>
              </span>
            </button>
          )}

          {/* 空状态（无搜索词时才显示） */}
          {!query.trim() && (isCountryMode ? countryList : cityList).length === 0 && (
            <p className="py-10 text-center text-xs text-muted-foreground">
              {t("encyclopedia.pickerNoMatch")}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
