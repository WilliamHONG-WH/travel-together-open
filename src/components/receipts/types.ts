export interface Receipt {
  id: string;
  trip_id: string;
  title: string;
  image_url: string;
  /**
   * 多图票据（JSONB 数组）：2026-08 升级，一张票据可挂多张照片。
   * 旧数据仅有 image_url 时，读取侧通过 getReceiptImages() 自动转为 [image_url]。
   */
  images?: string[];
  /**
   * 完整地点字符串（兼容旧数据）：格式 `城市 · 详细地址`。
   * 新数据建议同时填充 city_key + detail_address，本字段作为冗余保留。
   */
  location: string;
  /**
   * 标准化城市 ID（key），对应 src/constants/locations.ts 中 GLOBAL_LOCATIONS[].cities[].key
   * 例如 "milan" / "paris" / "jinjiang"。
   * 数据库存储字段：receipts.city_key
   * 显示时通过 getLocalizedLocationName(city_key, locale) 解析为中/英文。
   */
  city_key?: string;
  /**
   * 详细地址（自由文本，如商店名/街道），不参与多语言翻译。
   * 与 city_key 组合显示为：`{本地化城市} · {detail_address}`
   */
  detail_address?: string;
  date: string;
  amount: number;
  currency: string;
  recorder: string;
  recorder_name: string;
  recorder_avatar_url: string | null;
  /** Legacy/alt avatar field for backward compatibility with older rows */
  avatar_url?: string | null;
  note: string;
  is_shared: boolean;
  /** Starred / featured flag for team shared visibility */
  is_starred?: boolean;
  /** Creator user ID (same as recorder for receipts) */
  user_id?: string;
  created_at: string;
  updated_at: string;
}

export interface TeamMember {
  id: string;
  user_id: string;
  display_name: string;
  avatar_url: string | null;
}
