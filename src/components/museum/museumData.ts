export interface Exhibit {
  id: string;
  name: string;
  nameCn?: string;
  image: string;
  background: string;
  story: string;
}

/**
 * 高清导览图附件（多张场馆地图）。
 * 数据库存储字段：encyclopedia_items.attachments (JSONB 数组)。
 */
export interface Attachment {
  id: string;
  /** 地图标题，如 "Uffizi 1F Map" */
  title: string;
  /** Supabase Storage 路径/URL */
  url: string;
}

export interface Museum {
  id: string;
  name: string;
  nameCn?: string;
  /**
   * 标准化国家 ID（key），对应 src/constants/locations.ts 中 GLOBAL_LOCATIONS[].key
   * 例如 "france" / "uk" / "china"。
   * 数据库存储字段：encyclopedia_items.country_key
   * 显示时通过 getLocalizedCountry(countryKey, locale) 解析为中/英文。
   */
  countryKey: string;
  /**
   * 标准化城市 ID（key），对应 GLOBAL_LOCATIONS[].cities[].key
   * 例如 "paris" / "london" / "jinjiang"。
   * 数据库存储字段：encyclopedia_items.city_key
   * 显示时通过 getLocalizedCity(cityKey, locale, countryKey) 解析。
   */
  cityKey: string;
  address: string;
  /**
   * 定位信息（与 address 互补，DB 字段 encyclopedia_items.location）。
   * 前端表单暂无独立输入框，保留字段用于读写 DB 真实数据，避免被过滤。
   */
  location?: string;
  hours: string;
  cover: string;
  snippet: string;
  intro: string;
  exhibits: Exhibit[];
  /**
   * 相关文物（JSONB 数组，DB 字段 encyclopedia_items.artifacts）。
   * 前端表单暂无独立输入框，保留字段用于读写 DB 真实数据，避免被过滤。
   */
  artifacts?: any[];
  /**
   * 多张高清导览图（DB 字段 encyclopedia_items.attachments，JSONB 数组）—— 地图资料唯一入口。
   * 编辑态支持多选上传（4096px / 2MB 高清通道，仅限图片格式），浏览态缩略图 + 手势缩放全屏预览。
   */
  attachments?: Attachment[];
  planned?: boolean;
  createdAt?: string;
  /**
   * 纬度（DB 字段 encyclopedia_items.latitude）。
   * 新建/编辑/文档导入保存时由 Nominatim 正向地理编码
   * （场馆名称 + 详细地址 + 城市 + 国家）自动回填，用于地图联动标记。
   */
  latitude?: number;
  /** 经度（DB 字段 encyclopedia_items.longitude），同 latitude 自动回填 */
  longitude?: number;
}

export const INITIAL_MUSEUMS: Museum[] = [
  {
    id: "louvre",
    name: "The Louvre",
    nameCn: "卢浮宫",
    countryKey: "france",
    cityKey: "paris",
    address: "Rue de Rivoli, 75001 Paris, France",
    hours: "Mon, Wed–Sun · 09:00 – 18:00 (Closed Tuesdays)",
    cover:
      "https://images.unsplash.com/photo-1565799515994-1b8f2e0f7d9f?w=1200&q=80&auto=format&fit=crop",
    snippet:
      "The world's most-visited museum, home to over 380,000 objects spanning ancient civilizations to 19th-century masterpieces.",
    intro:
      "Originally a 12th-century fortress, the Louvre became a public museum in 1793 during the French Revolution. Its iconic glass pyramid, designed by I. M. Pei and inaugurated in 1989, marks the main entrance and blends modern architecture with the palace's historical grandeur. Today it houses masterpieces from Egyptian antiquities to Italian Renaissance paintings.",
    planned: true,
    exhibits: [
      {
        id: "mona-lisa",
        name: "Mona Lisa",
        nameCn: "蒙娜丽莎",
        image:
          "https://images.unsplash.com/photo-1554907984-15263bfd63bd?w=800&q=80&auto=format&fit=crop",
        background:
          "Painted by Leonardo da Vinci between 1503 and 1519, the Mona Lisa is an oil portrait on a poplar wood panel measuring just 77 × 53 cm. It has hung in the Louvre since 1797 and is protected behind bulletproof glass in the Salle des États.",
        story:
          "In 1911 the painting was stolen by an Italian handyman, Vincenzo Peruggia, who believed it should be returned to Italy. Its two-year disappearance turned the Mona Lisa into a global celebrity — when it returned, crowds queued for hours just to catch a glimpse of her enigmatic smile.",
      },
      {
        id: "winged-victory",
        name: "Winged Victory of Samothrace",
        nameCn: "萨莫色雷斯的胜利女神",
        image:
          "https://images.unsplash.com/photo-1608501078713-8e445a709b39?w=800&q=80&auto=format&fit=crop",
        background:
          "Carved around 190 BCE in Parian marble, this Hellenistic sculpture depicts Nike, the goddess of victory, alighting on the prow of a ship. It was discovered in 1863 on the Aegean island of Samothrace by French consul Charles Champoiseau.",
        story:
          "Though missing her head and arms, the Winged Victory is celebrated for the dramatic motion of her wind-swept robes. She dominates the top of the Daru staircase, appearing to soar down toward every visitor who climbs to meet her.",
      },
    ],
  },
  {
    id: "british-museum",
    name: "The British Museum",
    nameCn: "大英博物馆",
    countryKey: "uk",
    cityKey: "london",
    address: "Great Russell Street, London WC1B 3DG, United Kingdom",
    hours: "Daily · 10:00 – 17:00 (Fri until 20:30)",
    cover:
      "https://images.unsplash.com/photo-1552832230-c0197dd311b5?w=1200&q=80&auto=format&fit=crop",
    snippet:
      "Founded in 1753, the world's first national public museum, holding 8 million works chronicling human culture from its origins to the present.",
    intro:
      "The British Museum was established by an Act of Parliament and opened to the public in 1759. Its collection spans two million years of history across every continent, including the Rosetta Stone, the Parthenon sculptures, and the Sutton Hoo treasures. Admission has been free since its founding.",
    exhibits: [
      {
        id: "rosetta-stone",
        name: "Rosetta Stone",
        nameCn: "罗塞塔石碑",
        image:
          "https://images.unsplash.com/photo-1590486803833-1c5dc8ddd4c8?w=800&q=80&auto=format&fit=crop",
        background:
          "Discovered in 1799 near the town of Rashid (Rosetta) in Egypt by French soldiers during Napoleon's campaign, this granodiorite stele dates to 196 BCE. It records a decree issued in Memphis on behalf of King Ptolemy V in three scripts: hieroglyphic, Demotic, and Ancient Greek.",
        story:
          "Because the same text appears in three scripts, the Rosetta Stone provided the key to deciphering Egyptian hieroglyphs. In 1822, French scholar Jean-François Champollion cracked the code, unlocking millennia of Egyptian history. It has been on continuous public display in the British Museum since 1802.",
      },
    ],
  },
];
