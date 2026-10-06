import { X, MapPin, Globe } from "lucide-react";

/**
 * 共享的「国家 · 城市」联动筛选弹窗 (居中遮罩版)。
 * - 选择国家 → 城市列表自动收缩为该国家下的城市
 * - 选择城市 → 自动锁定其所属的国家
 * - 再次点击已选中的胶囊即可取消选中 (取消后该维度不限制)
 *
 * 用于足迹模块 (StampCollection) 与百科模块 (MuseumEncyclopedia)。
 */
interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** 所有可选国家 (原始 key) */
  countries: string[];
  /** 完整的城市→国家映射 (不受当前国家筛选限制) */
  cityCountryPairs: { city: string; country: string }[];
  /** 当前选中的国家 ("all" = 未选) */
  selectedCountry: string;
  /** 当前选中的城市 ("all" = 未选) */
  selectedCity: string;
  /** 选择变更回调，同时返回 (country, city) */
  onSelect: (country: string, city: string) => void;
  /** 国家名称本地化格式化函数 */
  formatCountry: (c: string) => string;
  /** 城市名称本地化格式化函数 */
  formatCity: (c: string) => string;
  isEn: boolean;
}

const ALL = "all";

export function LocationFilterModal({
  isOpen,
  onClose,
  countries,
  cityCountryPairs,
  selectedCountry,
  selectedCity,
  onSelect,
  formatCountry,
  formatCity,
  isEn,
}: Props) {
  if (!isOpen) return null;

  // 当前国家筛选下的城市列表 (国家未选时展示全部城市)
  const visibleCities =
    selectedCountry === ALL
      ? cityCountryPairs
      : cityCountryPairs.filter((p) => p.country === selectedCountry);

  // 选择/取消国家：再次点击已选中的国家 → 取消 (回到 all)；否则切换为该国家，城市重置
  const handleSelectCountry = (c: string) => {
    const next = c === selectedCountry ? ALL : c;
    onSelect(next, ALL);
  };

  // 选择城市：自动锁定其所属国家；再次点击已选中的城市 → 取消 (回到 all)
  const handleSelectCity = (cityName: string) => {
    if (cityName === selectedCity) {
      // 取消选中城市 (国家保持)
      onSelect(selectedCountry, ALL);
      return;
    }
    const pair = cityCountryPairs.find((p) => p.city === cityName);
    if (pair) {
      // 选中城市 → 自动匹配并锁定国家
      onSelect(pair.country, cityName);
    } else {
      onSelect(selectedCountry, cityName);
    }
  };

  // 去重后的城市列表
  const uniqueCities = visibleCities
    .map((p) => p.city)
    .filter((v, i, arr) => arr.indexOf(v) === i);

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-sm max-h-[75vh] bg-card border border-border rounded-3xl p-5 shadow-2xl flex flex-col animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 顶部仅保留 X 关闭按钮 */}
        <div className="flex justify-end shrink-0 mb-2">
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 rounded-full bg-muted text-muted-foreground hover:text-foreground hover:bg-muted transition-all active:scale-95"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 可滚动内容区 */}
        <div className="flex-1 overflow-y-auto overscroll-contain space-y-5 pr-1 scrollbar-thin">
          {/* 国家区 */}
          <div>
            <div className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
              <Globe className="w-3.5 h-3.5" />
              <span>{isEn ? "Country" : "国家"}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {countries.map((c) => (
                <button
                  key={c}
                  onClick={() => handleSelectCountry(c)}
                  className={`px-3.5 py-1.5 rounded-full text-xs font-medium transition-all ${
                    selectedCountry === c
                      ? "bg-brand/20 text-brand border border-brand/40"
                      : "bg-muted text-muted-foreground border border-border hover:bg-muted"
                  }`}
                >
                  {formatCountry(c)}
                </button>
              ))}
            </div>
          </div>

          {/* 城市区 */}
          <div>
            <div className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5" />
              <span>{isEn ? "City" : "城市"}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {uniqueCities.map((c) => (
                <button
                  key={c}
                  onClick={() => handleSelectCity(c)}
                  className={`px-3.5 py-1.5 rounded-full text-xs font-medium transition-all ${
                    selectedCity === c
                      ? "bg-brand/20 text-brand border border-brand/40"
                      : "bg-muted text-muted-foreground border border-border hover:bg-muted"
                  }`}
                >
                  {formatCity(c)}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
