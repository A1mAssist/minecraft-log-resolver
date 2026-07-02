const DEFAULT_AVATAR_URL = "/src/app/assets/steve-avatar.png";
const AVATAR_STORAGE_KEY = "mc-log-avatar";
const PLAYER_PROFILE_STORAGE_KEY = "mc-log-player-profile";
const WIN_STREAK_POLICY_STORAGE_KEY = "mc-log-win-streak-policy";
const THEME_STORAGE_KEY = "mc-log-theme";
const AUDIT_OOBE_STORAGE_KEY = "mc-log-audit-oobe-dismissed";
const SHARE_STAT_SLOTS_STORAGE_KEY = "mc-log-share-stat-slots";
const SHARE_EXPORT_DPI = 300;
const AUDIT_REVIEW_LABELS = ["keep-unknown", "win", "loss", "ignore", "new-rule-needed"];
const RULE_DRAFT_TYPES = ["round_end", "win", "loss", "ignore", "boundary", "diagnostic"];
const DEFAULT_SHARE_STAT_SLOTS = ["playtime", "reliableRecords", "currentWinStreak", "playerMaxKillStreak", "topServer", "topMode"];
const SHARE_STAT_OPTION_KEYS = [
  "playtime",
  "reliableRecords",
  "officialMatches",
  "activityRecords",
  "wins",
  "losses",
  "currentWinStreak",
  "playerMaxKillStreak",
  "selfKills",
  "selfDeaths",
  "playerBedDestroys",
  "topServer",
  "serverCount",
  "topMode",
  "modeCount",
  "unknownResults",
  "firstRecord",
  "lastRecord",
];
const SHARE_STAT_SLOT_LIMIT = 6;

function defaultRulePackJson() {
  return JSON.stringify({
    id: "local-review-rules",
    name: "Local review rules",
    rules: [],
  }, null, 2);
}

const state = {
  summary: null,
  profile: null,
  recentRounds: null,
  rounds: null,
  modesData: null,
  accountPlaytime: null,
  candidates: null,
  store: null,
  results: null,
  auditRounds: null,
  rulePacks: null,
  userRulePacks: null,
  rulesReport: null,
  rulesDoctor: null,
  rulesAudit: null,
  accounts: null,
  identityRounds: null,
  identityActivity: null,
  appStatus: null,
  daySeries: null,
  monthSeries: null,
  refresh: null,
  setupMode: false,
  oobe: {
    rootText: "",
    picking: false,
    validating: false,
    saving: false,
    validation: null,
    error: "",
    message: "",
  },
  locale: readStoredLocale(),
  themePreference: readThemePreference(),
  theme: readStoredTheme(),
  avatar: readStoredAvatar(),
  playerProfile: readStoredPlayerProfile(),
  avatarFallback: null,
  avatarLoading: false,
  loading: {
    initial: true,
  },
  profileAliasOpen: false,
  profileEditorOpen: false,
  profileDraftName: null,
  activeTab: "overview",
  shareFrame: "wide",
  shareKind: "overview",
  shareModeMetric: "rounds",
  sharePrimaryBar: "server",
  shareSecondaryBar: "mode",
  shareStatSlots: readStoredShareStatSlots(),
  overviewModeSort: "rounds",
  overviewSourceSort: "duration",
  overviewServerSort: "duration",
  winStreakPolicy: readStoredWinStreakPolicy(),
  matchesPage: 0,
  matchesPageSize: 24,
  matchesViewMode: "cards",
  matchesSort: "newest",
  modesPage: 0,
  modesPageSize: 12,
  modesViewMode: "cards",
  identityPage: 0,
  identityPageSize: 12,
  identityViewMode: "cards",
  heatmapWindowIndex: 0,
  expandedRoundKey: "",
  roundDebugOpenKey: "",
  activeRoundDetail: null,
  roundDetailReturnTab: "matches",
  activeTapeRoundKey: "",
  roundSearchCache: null,
  filterPanelOpen: false,
  toast: null,
  query: "",
  filters: {
    mode: "",
    result: "",
    source: "",
  },
  auditFilters: {
    mode: "",
    priority: "high",
    category: "",
    nextAction: "",
  },
  auditPage: 0,
  auditPageSize: 12,
  auditOobeOpen: !readAuditOobeDismissed(),
  activeAuditRoundKey: "",
  auditLabels: {},
  auditBusy: false,
  auditStatus: null,
  auditValidation: null,
  auditWorkflow: null,
  auditRuleMessage: "",
  auditRuleType: "round_end",
  auditRuleMode: "bedwars",
  auditRulePackJson: defaultRulePackJson(),
  auditRuleTest: null,
  auditRuleDraft: null,
  auditRuleValidation: null,
  auditRuleDryRun: null,
  auditRulePackSave: null,
  auditRulePackDetail: null,
  auditRuleBackups: null,
  auditSelectedUserRulePackId: "",
};

const root = document.querySelector("#root");
let interactionController = null;
let activeTapeTooltipKey = "";
// Tabler Icons SVG paths (MIT), inlined to keep the app dependency-free.
const TABLER_ICON_PATHS = {
  TIME: {
    name: "clock",
    body: '<path d="M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0"></path><path d="M12 7v5l3 3"></path>',
  },
  ROUND: {
    name: "shield-check",
    body: '<path d="M11.46 20.846a12 12 0 0 1 -7.96 -14.846a12 12 0 0 0 8.5 -3a12 12 0 0 0 8.5 3a12 12 0 0 1 -.09 7.06"></path><path d="M15 19l2 2l4 -4"></path>',
  },
  "K/D": {
    name: "swords",
    body: '<path d="M10 14l-6 -6v-4h4l6 6"></path><path d="M14 10l6 -6h-4l-6 6"></path><path d="M10 14l-6 6"></path><path d="M14 14l6 6"></path><path d="M14 14l-4 -4"></path>',
  },
  STREAK: {
    name: "trending-up",
    body: '<path d="M3 17l6 -6l4 4l8 -8"></path><path d="M14 7h7v7"></path>',
  },
  search: {
    name: "search",
    body: '<path d="M10 10m-7 0a7 7 0 1 0 14 0a7 7 0 1 0 -14 0"></path><path d="M21 21l-6 -6"></path>',
  },
  folder: {
    name: "folder-open",
    body: '<path d="M5 19l2.757 -7.351a1 1 0 0 1 .936 -.649h12.307a1 1 0 0 1 .986 1.164l-.996 5.211a2 2 0 0 1 -1.964 1.625h-14.026a2 2 0 0 1 -2 -2v-11a2 2 0 0 1 2 -2h4l3 3h7a2 2 0 0 1 2 2v2"></path>',
  },
  shieldCheck: {
    name: "shield-check",
    body: '<path d="M11.46 20.846a12 12 0 0 1 -7.96 -14.846a12 12 0 0 0 8.5 -3a12 12 0 0 0 8.5 3a12 12 0 0 1 -.09 7.06"></path><path d="M15 19l2 2l4 -4"></path>',
  },
  refresh: {
    name: "refresh",
    body: '<path d="M20 11a8.1 8.1 0 0 0 -15.5 -2m-.5 -4v4h4"></path><path d="M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4"></path>',
  },
  download: {
    name: "download",
    body: '<path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2"></path><path d="M7 11l5 5l5 -5"></path><path d="M12 4l0 12"></path>',
  },
  share: {
    name: "share-3",
    body: '<path d="M13 5l7 7l-7 7"></path><path d="M5 12h15"></path>',
  },
  copy: {
    name: "copy",
    body: '<path d="M8 8m0 2a2 2 0 0 1 2 -2h8a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-8a2 2 0 0 1 -2 -2z"></path><path d="M16 8v-2a2 2 0 0 0 -2 -2h-8a2 2 0 0 0 -2 2v8a2 2 0 0 0 2 2h2"></path>',
  },
  adjustments: {
    name: "adjustments-horizontal",
    body: '<path d="M4 6l9 0"></path><path d="M17 6l3 0"></path><path d="M4 12l3 0"></path><path d="M11 12l9 0"></path><path d="M4 18l9 0"></path><path d="M17 18l3 0"></path><path d="M14 4l0 4"></path><path d="M8 10l0 4"></path><path d="M14 16l0 4"></path>',
  },
  route: {
    name: "route",
    body: '<path d="M3 7a2 2 0 1 0 4 0a2 2 0 0 0 -4 0"></path><path d="M17 17a2 2 0 1 0 4 0a2 2 0 0 0 -4 0"></path><path d="M5 9v4a4 4 0 0 0 4 4h8"></path><path d="M9 17l3 -3"></path><path d="M9 17l3 3"></path>',
  },
  checklist: {
    name: "list-check",
    body: '<path d="M11 6h9"></path><path d="M11 12h9"></path><path d="M11 18h9"></path><path d="M4 6l1 1l3 -3"></path><path d="M4 12l1 1l3 -3"></path><path d="M4 18l1 1l3 -3"></path>',
  },
  flask: {
    name: "flask",
    body: '<path d="M9 3l6 0"></path><path d="M10 9l4 0"></path><path d="M10 3v6l-4 8a3 3 0 0 0 2.7 4.3h6.6a3 3 0 0 0 2.7 -4.3l-4 -8v-6"></path>',
  },
  database: {
    name: "database",
    body: '<path d="M4 6c0 1.657 3.582 3 8 3s8 -1.343 8 -3s-3.582 -3 -8 -3s-8 1.343 -8 3"></path><path d="M4 6v6c0 1.657 3.582 3 8 3s8 -1.343 8 -3v-6"></path><path d="M4 12v6c0 1.657 3.582 3 8 3s8 -1.343 8 -3v-6"></path>',
  },
  x: {
    name: "x",
    body: '<path d="M18 6l-12 12"></path><path d="M6 6l12 12"></path>',
  },
  plus: {
    name: "plus",
    body: '<path d="M12 5v14"></path><path d="M5 12h14"></path>',
  },
  grip: {
    name: "grip-vertical",
    body: '<path d="M9 5m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"></path><path d="M9 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"></path><path d="M9 19m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"></path><path d="M15 5m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"></path><path d="M15 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"></path><path d="M15 19m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"></path>',
  },
  userSquare: {
    name: "user-square-rounded",
    body: '<path d="M12 13a3 3 0 1 0 0 -6a3 3 0 0 0 0 6z"></path><path d="M6 20v-1a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v1"></path><path d="M4 4m0 2a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2z"></path>',
  },
  sun: {
    name: "sun",
    body: '<path d="M12 12m-4 0a4 4 0 1 0 8 0a4 4 0 1 0 -8 0"></path><path d="M3 12h1"></path><path d="M20 12h1"></path><path d="M12 3v1"></path><path d="M12 20v1"></path><path d="M5.6 5.6l.7 .7"></path><path d="M17.7 17.7l.7 .7"></path><path d="M18.4 5.6l-.7 .7"></path><path d="M6.3 17.7l-.7 .7"></path>',
  },
  moon: {
    name: "moon",
    body: '<path d="M12 3c.132 0 .263 .003 .393 .008a7.5 7.5 0 0 0 7.92 11.522a9 9 0 1 1 -8.313 -11.53z"></path>',
  },
  monitor: {
    name: "device-desktop",
    body: '<path d="M3 5m0 2a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2z"></path><path d="M8 21h8"></path><path d="M12 17v4"></path>',
  },
  chevronLeft: {
    name: "chevron-left",
    body: '<path d="M15 6l-6 6l6 6"></path>',
  },
  chevronRight: {
    name: "chevron-right",
    body: '<path d="M9 6l6 6l-6 6"></path>',
  },
  chevronUp: {
    name: "chevron-up",
    body: '<path d="M6 15l6 -6l6 6"></path>',
  },
  chevronDown: {
    name: "chevron-down",
    body: '<path d="M6 9l6 6l6 -6"></path>',
  },
  rectangle: {
    name: "rectangle",
    body: '<path d="M4 6m0 2a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2z"></path>',
  },
  square: {
    name: "square",
    body: '<path d="M5 5m0 2a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v10a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2z"></path>',
  },
};

const I18N = {
  zh: {
    languageLabel: "语言",
    themeLabel: "主题",
    theme: {
      system: "跟随系统",
      light: "亮色",
      dark: "暗色",
    },
    localeName: "中文",
    otherLocaleName: "English",
    localBadge: "LOCAL",
    common: {
      all: "全部",
      unknown: "未知",
      none: "无",
      mixed: "混合",
      localLogs: "本地日志",
      local: "本地",
      player: "玩家",
      files: "文件",
      heat: "热力",
      winRate: "胜率",
      days: "天",
      items: "项",
      records: "条",
      rounds: "场",
      sources: "来源",
      aliases: "别名",
      wins: "胜",
      losses: "负",
      earlier: "较早",
      latest: "最新",
      less: "少",
      more: "多",
      generated: "生成",
      sourceHidden: "来源已隐藏",
      scopeHidden: "范围已隐藏",
      clientHidden: "客户端已隐藏",
    },
    tabs: {
      overview: "总览",
      matches: "对局",
      modes: "模式",
      identity: "身份",
      share: "分享",
      audit: "审计",
    },
    actions: {
      refreshReport: "刷新报告",
      exportShareCard: "导出分享卡",
      advancedFilters: "高级筛选",
      clearFilters: "清空筛选",
      collapsePanel: "收起面板",
      refresh: "刷新",
      exportCard: "导出卡片",
      expandFilters: "展开筛选",
      collapseFilters: "收起筛选",
      clear: "清空",
      refreshAudit: "刷新审计",
      downloadPng: "下载 PNG",
      copyText: "复制文本",
      generating: "正在生成",
      downloaded: "已下载",
      exportFailed: "导出失败",
      copied: "已复制",
      copyFailed: "复制失败",
    },
    aria: {
      workspaceViews: "工作台视图",
      globalFilters: "全局筛选",
      searchMatches: "搜索对局",
      resultFilter: "结果筛选",
      advancedFilterPanel: "高级筛选面板",
      advancedResultFilter: "高级结果筛选",
      modeFilter: "模式筛选",
      sourceFilter: "来源筛选",
      shareFrame: "分享卡画幅",
      sharePreview: "分享卡预览",
      winLossSplit: "胜负占比",
      verifiedLocalPlayer: "已确认的本地玩家",
    },
    boot: {
      loadingTitle: "正在打开 MC Log Analytics",
      loadingDetail: "正在从本地 API 读取报告数据。",
      errorTitle: "工作台启动失败",
    },
    filters: {
      searchPlaceholder: "搜索模式、来源、结果…",
      allModes: "全部模式",
      allSources: "全部来源",
      allResults: "全部结果",
      noInput: "未输入",
      title: "高级筛选",
      search: "搜索",
      result: "结果",
      mode: "模式",
      source: "来源",
    },
    overview: {
      playtime: "游玩时长",
      allLocalSessions: "全部本地会话",
      reliableRounds: "可靠记录",
      officialMatches: "正式对局",
      highConfidenceRecord: "正式胜负与活动记录",
      selfKd: "自身 K/D",
      killsDeaths: "击杀 / 死亡",
      peakStreak: "最高连胜",
      currentWinStreak: "当前连胜",
      bestDetectedStreak: "检测到的最佳连胜",
      currentWinStreakSub: "按当前连胜策略计算",
      playerKillStreak: "本人最高连杀",
      playerKillStreakSub: "仅本人击杀，死亡或边界重置",
      winStreakBreakUnknown: "未知断开",
      winStreakSkipUnknown: "跳过未知",
      dossier: "本地战绩档案",
      summary: "从 {files} 个日志文件中整理出 {recordSummary}，当前胜率 {winRate}。",
      chatLines: "聊天行",
      logSources: "日志来源",
      generatedAt: "生成时间",
      firstSeen: "首次出现",
      lastSeen: "最近出现",
      logFiles: "日志文件",
      client: "客户端",
      identity: "身份",
      confirmed: "已确认",
      linked: "已关联",
      noAliases: "没有找到局内名称。",
      winLoss: "胜负概览",
      identified: "已识别 {rate}",
      recentMatches: "最近对局",
      noRecentMatches: "没有可绘制的最近对局。",
      activityHeat: "活跃热力 / 13 周",
      activeDays: "{count} 个活跃日",
      roundCount: "{count} 场对局",
      recordCount: "{count} 条记录",
      activityCount: "{count} 段活动",
      reliableRecordBreakdown: "{matches} 场对局 + {activities} 段活动",
      calendarCells: "{count} 个日历格",
      modeBreakdown: "模式分布",
      noModeData: "没有模式数据。",
      killsDuration: "{kills} 本人击杀 / {duration}",
      roundsKills: "{rounds} 场 / {kills} 本人击杀",
      activitiesKills: "{segments} 段 / {kills} 本人击杀",
      sortByRounds: "按局数",
      sortByDuration: "按时长",
      sortByKills: "按本人击杀",
      sortByClient: "按名称",
      sortModeBreakdown: "模式分布排序",
      sortSourceCoverage: "来源覆盖排序",
      clientRoot: "客户端根目录",
      serverIdentities: "局内名称",
      serverIdentityCount: "{count} 个名称",
      noServerIdentities: "没有足够的局内名称证据。",
      sourceCoverage: "来源覆盖",
      sourceCount: "{count} 个来源",
      auditOverview: "审计概览",
      signals: "{count} 条信号",
      reliable: "可信",
      ignored: "忽略",
    },
    matches: {
      eyebrow: "对局审计轨迹",
      title: "正式对局",
      querySuffix: "，搜索命中 {count} 条",
      summary: "筛选后共有 {total} 条记录，当前展示{order} {shown} 条{suffix}。",
      newestOrder: "最新",
      oldestOrder: "最早",
      noMatches: "当前筛选下没有正式对局。",
      duration: "时长",
      selfKills: "本人击杀",
      deaths: "死亡",
      source: "来源",
    },
    modes: {
      eyebrow: "模式",
      title: "玩法分布",
      summary: "本地日志中识别到 {count} 种玩法模式。",
      rounds: "对局",
      activities: "活动段",
      duration: "时长",
      kills: "观测击杀",
      selfKills: "本人击杀",
      noRecords: "没有可用的模式记录。",
    },
    identity: {
      eyebrow: "身份",
      title: "局内名称证据",
      summary: "识别出 {identities} 个服务器内名称，累计 {evidence} 条局内证据。",
      matches: "对局",
      evidence: "证据",
      direct: "直接命中",
      noRecords: "没有可用的局内名称证据。",
    },
    share: {
      eyebrow: "分享卡",
      title: "战绩档案导出",
      summary: "预览内容和 PNG 导出使用同一份数据，避免分享图与页面信息不一致。",
      frame: "导出画幅",
      player: "玩家",
      source: "来源",
      client: "客户端",
      playtime: "游玩时长",
      generatedAt: "生成时间",
      included: "包含信息",
      includedName: "名称",
      includedData: "数据",
      includedWinLoss: "胜负",
      includedStreak: "连胜",
      includedTape: "对局带",
      preview: "预览",
      square: "方图",
      wide: "横版",
      recordDossier: "战绩档案",
      win: "胜",
      loss: "负",
      streak: "连胜 {value}",
      recentTape: "最近 {count} 条记录",
      recentTapeSummary: "{wins} 胜 / {losses} 负",
      reliableRounds: "可靠记录",
      files: "{count} 个文件",
      chatLines: "{count} 行聊天",
      topModeFallback: "混合模式",
      footerFull: "{client} / {files} / {chatLines}",
      winsLosses: "{wins} 胜 / {losses} 负",
      generatedLine: "生成时间：{date}",
      shareTextPlay: "游玩时长：{playtime}；可靠记录：{rounds}；胜率：{winRate}",
      shareTextKd: "K/D：{kd}；{winsLosses}；最高连胜：{streak}；当前连胜：{currentStreak}；本人最高连杀：{killStreak}",
      shareTextLogs: "日志：{files}；聊天：{chatLines}",
    },
    oobe: {
      eyebrow: "首次设置",
      title: "连接 Minecraft 日志目录",
      summary: "选择包含 logs 的 .minecraft 目录或启动器实例目录，保存后会扫描日志并生成本地战绩数据。",
      rootLabel: "日志根目录",
      rootPlaceholder: "例如 C:\\Users\\你\\AppData\\Roaming\\.minecraft",
      choose: "选择目录",
      validate: "验证目录",
      save: "保存并扫描",
      refresh: "扫描日志",
      choosing: "正在打开",
      validating: "正在验证",
      saving: "正在保存",
      refreshing: "正在扫描日志",
      readyToRefresh: "目录已保存，需要扫描日志。",
      firstRunHint: "路径只保存在本机配置里，不会写入分享卡或诊断包。",
      manualHint: "如果系统选择器不可用，可以直接粘贴绝对路径。",
      validationPassed: "目录可用：{files} 个日志文件，{scopes} 个范围。",
      validationFailed: "没有找到可用日志。请选择实际 .minecraft 目录或包含 logs 的实例目录。",
      saved: "日志目录已保存，开始扫描。",
      pickerCancelled: "已取消目录选择。",
      pickerUnavailable: "系统目录选择器不可用，请手动粘贴路径。",
      pickerOpened: "正在打开系统目录选择器。",
      pickerSelected: "目录已加入，验证后即可保存。",
      required: "请输入至少一个日志目录。",
      currentRoots: "当前目录",
      status: "状态",
      refreshReasons: "等待处理",
    },
    avatar: {
      title: "玩家资料",
      subtitle: "显示 ID、头像、分享卡使用同一份资料。",
      summary: "头像和 ID 会同步到分享卡。",
      edit: "编辑资料",
      close: "关闭",
      usernameLabel: "Minecraft ID",
      usernamePlaceholder: "输入正版用户名",
      aliasLabel: "填入局内名称",
      aliasCount: "{count} 个名称",
      noAliases: "没有可选名称",
      load: "保存并拉取皮肤",
      loadingAction: "正在拉取皮肤",
      upload: "上传图片",
      reset: "使用 Steve",
      keepCurrent: "保留当前头像",
      sourceDefault: "默认 Steve",
      sourceUsername: "官方皮肤 / {username}",
      sourceUpload: "本地上传",
      loading: "正在查询官方资料…",
      loaded: "玩家资料已更新。",
      uploadReady: "上传头像已应用。",
      resetDone: "已使用 Steve 头像。",
      failed: "没有拉到官方皮肤，请选择头像来源。",
      invalidName: "请输入 1-16 位英文、数字或下划线的 Minecraft ID。",
      fallbackTitle: "官方皮肤不可用",
      fallbackDetail: "为 {username} 选择一个头像来源。",
      fallbackReason: "原因：{reason}",
      uploadFailed: "图片读取失败，请重新选择。",
      alt: "{player} 的 Minecraft 头像",
    },
    audit: {
      eyebrow: "审计",
      title: "规则候选与本地存储",
      summary: "用于复核解析规则、候选样本和本地数据可信度。",
      candidates: "规则候选",
      localStore: "本地存储",
      dataArtifacts: "数据产物",
      noCandidates: "没有待处理候选。",
      noStoreCounts: "没有可用的存储计数。",
      candidateRule: "候选规则",
    },
    command: {
      overviewLabel: "总览命令栏",
      matchesLabel: "对局命令栏",
      modesLabel: "模式命令栏",
      identityLabel: "身份命令栏",
      auditLabel: "审计命令栏",
      reliableSubtitle: "{count} 条可靠记录",
      filteredSubtitle: "{state} / {count} 条",
      searching: "搜索中",
      filtered: "筛选后",
      conditions: "条件",
      highest: "最高",
      modeCount: "{count} 种模式",
      localUsers: "{count} 个本地用户",
      candidateSubtitle: "{count} 条候选",
      inGameNames: "局内名称",
      identityEvidence: "身份确认",
      ruleAudit: "规则审计",
    },
    refresh: {
      startingLog: "正在重建本地报告…",
      started: "已开始刷新报告。",
      requestFailedLog: "刷新请求失败。",
      requestFailed: "刷新请求失败，请检查本地 API。",
      completed: "报告已刷新完成。",
      readFailedLog: "无法读取刷新状态。",
      readFailed: "无法读取刷新状态，请稍后重试。",
      defaultRunningLine: "正在刷新报告。",
      defaultDoneLine: "刷新完成。",
      running: "正在刷新",
      failed: "刷新失败",
      done: "刷新完成",
      busy: "正在刷新…",
    },
    toast: {
      filtersCleared: "筛选已清空。",
      pngDownloaded: "分享卡 PNG 已下载：{frame}。",
      pngFailed: "PNG 导出失败，请稍后重试。",
      copied: "分享文本已复制。",
      copyFailed: "复制失败，请检查浏览器剪贴板权限。",
    },
    results: {
      win: "胜利",
      loss: "失败",
      unknown: "未知",
      ambiguous: "冲突",
      not_applicable: "非胜负",
    },
    calendar: {
      weekdays: ["一", "二", "三", "四", "五", "六", "日"],
    },
  },
  en: {
    languageLabel: "Language",
    themeLabel: "Theme",
    theme: {
      system: "System",
      light: "Light",
      dark: "Dark",
    },
    localeName: "English",
    otherLocaleName: "中文",
    localBadge: "LOCAL",
    common: {
      all: "All",
      unknown: "Unknown",
      none: "None",
      mixed: "Mixed",
      localLogs: "Local logs",
      local: "Local",
      player: "Player",
      files: "Files",
      heat: "Heat",
      winRate: "Win rate",
      days: "days",
      items: "items",
      records: "records",
      rounds: "matches",
      sources: "sources",
      aliases: "aliases",
      wins: "W",
      losses: "L",
      earlier: "Earlier",
      latest: "Latest",
      less: "Less",
      more: "More",
      generated: "Generated",
      sourceHidden: "Source hidden",
      scopeHidden: "Scope hidden",
      clientHidden: "Client hidden",
    },
    tabs: {
      overview: "Overview",
      matches: "Matches",
      modes: "Modes",
      identity: "Identity",
      share: "Share",
      audit: "Audit",
    },
    actions: {
      refreshReport: "Refresh report",
      exportShareCard: "Export share card",
      advancedFilters: "Advanced filters",
      clearFilters: "Clear filters",
      collapsePanel: "Collapse panel",
      refresh: "Refresh",
      exportCard: "Export card",
      expandFilters: "Expand filters",
      collapseFilters: "Collapse filters",
      clear: "Clear",
      refreshAudit: "Refresh audit",
      downloadPng: "Download PNG",
      copyText: "Copy text",
      generating: "Generating",
      downloaded: "Downloaded",
      exportFailed: "Export failed",
      copied: "Copied",
      copyFailed: "Copy failed",
    },
    aria: {
      workspaceViews: "Workspace views",
      globalFilters: "Global filters",
      searchMatches: "Search matches",
      resultFilter: "Result filter",
      advancedFilterPanel: "Advanced filter panel",
      advancedResultFilter: "Advanced result filter",
      modeFilter: "Mode filter",
      sourceFilter: "Source filter",
      shareFrame: "Share card frame",
      sharePreview: "Share card preview",
      winLossSplit: "Win/loss split",
      verifiedLocalPlayer: "Verified local player",
    },
    boot: {
      loadingTitle: "Opening MC Log Analytics",
      loadingDetail: "Reading report data from the local API.",
      errorTitle: "Workbench failed to start",
    },
    filters: {
      searchPlaceholder: "Search mode, source, result...",
      allModes: "All modes",
      allSources: "All sources",
      allResults: "All results",
      noInput: "No query",
      title: "Advanced filters",
      search: "Search",
      result: "Result",
      mode: "Mode",
      source: "Source",
    },
    overview: {
      playtime: "Playtime",
      allLocalSessions: "All local sessions",
      reliableRounds: "Reliable records",
      officialMatches: "Result matches",
      highConfidenceRecord: "Result matches and activity records",
      selfKd: "Self K/D",
      killsDeaths: "Kills / deaths",
      peakStreak: "Peak streak",
      currentWinStreak: "Current win streak",
      bestDetectedStreak: "Best detected streak",
      currentWinStreakSub: "Using the selected streak policy",
      playerKillStreak: "Player kill streak",
      playerKillStreakSub: "Self kills only; deaths and boundaries reset it",
      winStreakBreakUnknown: "Unknown breaks",
      winStreakSkipUnknown: "Skip unknown",
      dossier: "Local record dossier",
      summary: "Compiled {recordSummary} from {files} log files. Current win rate is {winRate}.",
      chatLines: "Chat lines",
      logSources: "Log sources",
      generatedAt: "Generated",
      firstSeen: "First seen",
      lastSeen: "Last seen",
      logFiles: "Log files",
      client: "Client",
      identity: "Identity",
      confirmed: "Confirmed",
      linked: "Linked",
      noAliases: "No in-game names found.",
      winLoss: "Win/loss overview",
      identified: "{rate} identified",
      recentMatches: "Recent matches",
      noRecentMatches: "No recent matches to draw.",
      activityHeat: "Activity heat / 13 weeks",
      activeDays: "{count} active days",
      roundCount: "{count} matches",
      recordCount: "{count} records",
      activityCount: "{count} activity segments",
      reliableRecordBreakdown: "{matches} matches + {activities} activity segments",
      calendarCells: "{count} calendar cells",
      modeBreakdown: "Mode breakdown",
      noModeData: "No mode data.",
      killsDuration: "{kills} self kills / {duration}",
      roundsKills: "{rounds} matches / {kills} self kills",
      activitiesKills: "{segments} segments / {kills} self kills",
      sortByRounds: "Rounds",
      sortByDuration: "Time",
      sortByKills: "Self kills",
      sortByClient: "Name",
      sortModeBreakdown: "Mode breakdown sort",
      sortSourceCoverage: "Source coverage sort",
      clientRoot: "Client root",
      serverIdentities: "In-game names",
      serverIdentityCount: "{count} names",
      noServerIdentities: "Not enough in-game name evidence.",
      sourceCoverage: "Source coverage",
      sourceCount: "{count} sources",
      auditOverview: "Audit overview",
      signals: "{count} signals",
      reliable: "Reliable",
      ignored: "Ignored",
    },
    matches: {
      eyebrow: "Match audit trail",
      title: "Result matches",
      querySuffix: ", {count} search hits",
      summary: "{total} records after filtering. Showing the {order} {shown}{suffix}.",
      newestOrder: "latest",
      oldestOrder: "oldest",
      noMatches: "No result matches under the current filters.",
      duration: "Duration",
      selfKills: "Self kills",
      deaths: "Deaths",
      source: "Source",
    },
    modes: {
      eyebrow: "Modes",
      title: "Mode distribution",
      summary: "{count} gameplay modes were detected in local logs.",
      rounds: "Matches",
      activities: "Activity segments",
      duration: "Duration",
      kills: "Observed kills",
      selfKills: "Self kills",
      noRecords: "No mode records available.",
    },
    identity: {
      eyebrow: "Identity",
      title: "In-game name evidence",
      summary: "{identities} server-side names identified from {evidence} in-game evidence hits.",
      matches: "Matches",
      evidence: "Evidence",
      direct: "Direct hits",
      noRecords: "No in-game name evidence available.",
    },
    share: {
      eyebrow: "Share card",
      title: "Record dossier export",
      summary: "Preview and PNG export use the same data, so the shared image matches the page.",
      frame: "Export frame",
      player: "Player",
      source: "Source",
      client: "Client",
      playtime: "Playtime",
      generatedAt: "Generated",
      included: "Included",
      includedName: "Name",
      includedData: "Data",
      includedWinLoss: "Win/loss",
      includedStreak: "Streak",
      includedTape: "Match tape",
      preview: "Preview",
      square: "Square",
      wide: "Wide",
      recordDossier: "Record dossier",
      win: "W",
      loss: "L",
      streak: "Streak {value}",
      recentTape: "Last {count} records",
      recentTapeSummary: "{wins} W / {losses} L",
      reliableRounds: "Reliable records",
      files: "{count} files",
      chatLines: "{count} chat lines",
      topModeFallback: "Mixed modes",
      footerFull: "{client} / {files} / {chatLines}",
      winsLosses: "{wins} W / {losses} L",
      generatedLine: "Generated: {date}",
      shareTextPlay: "Playtime: {playtime}; reliable records: {rounds}; win rate: {winRate}",
      shareTextKd: "K/D: {kd}; {winsLosses}; peak streak: {streak}; current streak: {currentStreak}; player kill streak: {killStreak}",
      shareTextLogs: "Logs: {files}; chat: {chatLines}",
    },
    oobe: {
      eyebrow: "First run",
      title: "Connect your Minecraft logs",
      summary: "Choose a .minecraft folder or launcher instance folder that contains logs. The app will save it locally and scan your logs.",
      rootLabel: "Log root",
      rootPlaceholder: "For example C:\\Users\\you\\AppData\\Roaming\\.minecraft",
      choose: "Choose folder",
      validate: "Validate folder",
      save: "Save and scan",
      refresh: "Scan logs",
      choosing: "Opening",
      validating: "Validating",
      saving: "Saving",
      refreshing: "Scanning logs",
      readyToRefresh: "Folder saved. A log scan is required.",
      firstRunHint: "Paths stay in your local config and are not included in share cards or safe diagnostics.",
      manualHint: "If the system picker is unavailable, paste an absolute path.",
      validationPassed: "Folder is usable: {files} log files, {scopes} scopes.",
      validationFailed: "No usable logs were found. Choose the actual .minecraft folder or an instance folder with logs.",
      saved: "Log folder saved. Scan started.",
      pickerCancelled: "Folder selection cancelled.",
      pickerUnavailable: "System folder picker is unavailable. Paste a path manually.",
      pickerOpened: "Opening the system folder picker.",
      pickerSelected: "Folder added. Validate it before saving.",
      required: "Enter at least one log folder.",
      currentRoots: "Current folders",
      status: "Status",
      refreshReasons: "Pending work",
    },
    avatar: {
      title: "Player profile",
      subtitle: "One display ID and avatar for the dossier, share preview, and PNG export.",
      summary: "Avatar and ID are synced to the share card.",
      edit: "Edit profile",
      close: "Close",
      usernameLabel: "Minecraft ID",
      usernamePlaceholder: "Enter username",
      aliasLabel: "Fill from in-game names",
      aliasCount: "{count} names",
      noAliases: "No names available",
      load: "Save and fetch skin",
      loadingAction: "Fetching skin",
      upload: "Upload image",
      reset: "Use Steve",
      keepCurrent: "Keep current avatar",
      sourceDefault: "Default Steve",
      sourceUsername: "Official skin / {username}",
      sourceUpload: "Local upload",
      loading: "Looking up official profile...",
      loaded: "Player profile updated.",
      uploadReady: "Uploaded avatar applied.",
      resetDone: "Steve avatar applied.",
      failed: "Official skin was not found. Choose an avatar source.",
      invalidName: "Enter a 1-16 character Minecraft ID using letters, numbers, or underscores.",
      fallbackTitle: "Official skin unavailable",
      fallbackDetail: "Choose an avatar source for {username}.",
      fallbackReason: "Reason: {reason}",
      uploadFailed: "Could not read that image. Choose another file.",
      alt: "Minecraft avatar for {player}",
    },
    audit: {
      eyebrow: "Audit",
      title: "Rule candidates and local store",
      summary: "Review parsing rules, candidate samples, and local data confidence.",
      candidates: "Rule candidates",
      localStore: "Local store",
      dataArtifacts: "Data artifacts",
      noCandidates: "No pending candidates.",
      noStoreCounts: "No store counts available.",
      candidateRule: "Candidate rule",
    },
    command: {
      overviewLabel: "Overview command bar",
      matchesLabel: "Matches command bar",
      modesLabel: "Modes command bar",
      identityLabel: "Identity command bar",
      auditLabel: "Audit command bar",
      reliableSubtitle: "{count} reliable records",
      filteredSubtitle: "{state} / {count} records",
      searching: "Searching",
      filtered: "Filtered",
      conditions: "Conditions",
      highest: "Top",
      modeCount: "{count} modes",
      localUsers: "{count} local users",
      candidateSubtitle: "{count} candidates",
      inGameNames: "{count} in-game names",
      identityEvidence: "Identity evidence",
      ruleAudit: "Rule audit",
    },
    refresh: {
      startingLog: "Rebuilding the local report...",
      started: "Report refresh started.",
      requestFailedLog: "Refresh request failed.",
      requestFailed: "Refresh request failed. Check the local API.",
      completed: "Report refresh completed.",
      readFailedLog: "Could not read refresh status.",
      readFailed: "Could not read refresh status. Try again later.",
      defaultRunningLine: "Refreshing report.",
      defaultDoneLine: "Refresh complete.",
      running: "Refreshing",
      failed: "Refresh failed",
      done: "Refresh complete",
      busy: "Refreshing...",
    },
    toast: {
      filtersCleared: "Filters cleared.",
      pngDownloaded: "Share card PNG downloaded: {frame}.",
      pngFailed: "PNG export failed. Try again later.",
      copied: "Share text copied.",
      copyFailed: "Copy failed. Check browser clipboard permission.",
    },
    results: {
      win: "Win",
      loss: "Loss",
      unknown: "Unknown",
      ambiguous: "Ambiguous",
      not_applicable: "N/A",
    },
    calendar: {
      weekdays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    },
  },
};
let refreshTimer = null;
let toastTimer = null;

installSystemThemeSync();
renderLoading();
boot();

async function boot() {
  try {
    state.loading.initial = true;
    state.appStatus = await getJson("/api/app/status");
    state.refresh = visibleRefresh(state.appStatus.refresh) ?? visibleRefresh(state.refresh);
    if (shouldShowSetup(state.appStatus)) {
      state.setupMode = true;
      state.oobe.rootText = state.oobe.rootText || (state.appStatus.project?.roots ?? []).join("\n");
      state.loading.initial = false;
      renderSetup();
      return;
    }
    state.setupMode = false;
    const [summary, profile, modesData, recentRounds, rounds, identityRounds, identityActivity, accountPlaytime, candidates, store, accounts, daySeries, monthSeries, results, auditRounds, rulePacks, userRulePacks, rulesReport, rulesDoctor, rulesAudit] = await Promise.all([
      getJson("/api/summary"),
      getJson("/api/profile"),
      getOptionalJson("/api/modes", null),
      getJson("/api/rounds?set=reliable&limit=80"),
      getJson(`/api/rounds?${buildRoundsParams({ limit: 1000, offset: 0 })}`),
      getJson("/api/rounds?set=reliable&limit=1000"),
      getJson("/api/activity?limit=1000"),
      getJson("/api/accounts/playtime?limit=12"),
      getOptionalJson("/api/result-candidates?category=explicit_win&limit=8", { total: 0, items: [] }),
      getJson("/api/store"),
      getJson("/api/accounts"),
      getJson("/api/timeseries?period=day"),
      getJson("/api/timeseries?period=month"),
      getOptionalJson("/api/results", null),
      getOptionalJson(buildAuditRoundsPath(), { total: 0, items: [] }),
      getOptionalJson("/api/rule-packs", null),
      getOptionalJson("/api/rule-packs/user", null),
      getOptionalJson("/api/rules", null),
      getOptionalJson("/api/rules/doctor", null),
      getOptionalJson("/api/rules/audit", null),
    ]);

    state.summary = summary;
    state.profile = profile;
    state.modesData = modesData;
    state.rounds = rounds;
    state.roundSearchCache = rounds;
    state.identityRounds = identityRounds;
    state.recentRounds = buildRecentRounds(recentRounds, identityRounds);
    state.identityActivity = identityActivity;
    state.accountPlaytime = accountPlaytime;
    state.candidates = candidates;
    state.store = store;
    state.accounts = accounts;
    state.daySeries = daySeries;
    state.monthSeries = monthSeries;
    state.results = results;
    state.auditRounds = auditRounds;
    state.rulePacks = rulePacks;
    state.userRulePacks = userRulePacks;
    state.rulesReport = rulesReport;
    state.rulesDoctor = rulesDoctor;
    state.rulesAudit = rulesAudit;
    state.loading.initial = false;
    render();
  } catch (error) {
    if (await recoverBootToSetup(error)) return;
    state.loading.initial = false;
    renderError(error);
  }
}

async function recoverBootToSetup(error) {
  if (![404, 503].includes(Number(error?.status))) return false;
  try {
    state.appStatus = await getJson("/api/app/status");
    state.refresh = visibleRefresh(state.appStatus.refresh) ?? visibleRefresh(state.refresh);
    if (!shouldShowSetup(state.appStatus)) return false;
    state.setupMode = true;
    state.oobe.rootText = state.oobe.rootText || (state.appStatus.project?.roots ?? []).join("\n");
    state.loading.initial = false;
    renderSetup();
    if (state.refresh?.running) scheduleRefreshPoll();
    return true;
  } catch {
    return false;
  }
}

function shouldShowSetup(appStatus) {
  const setupState = appStatus?.setup?.state;
  const rootCount = Number(appStatus?.project?.rootCount ?? appStatus?.project?.roots?.length ?? 0);
  const dataReady = Boolean(appStatus?.setup?.dataReady || appStatus?.report?.ready || appStatus?.ready);
  if (setupState === "first_run") return true;
  if (!rootCount) return true;
  if (!dataReady && (setupState === "needs_refresh" || setupState === "refreshing")) return true;
  return false;
}

async function refreshRounds() {
  const params = buildRoundsParams({ limit: 1000, offset: 0 });
  const rounds = await getJson(`/api/rounds?${params}`);
  state.rounds = rounds;
  state.roundSearchCache = rounds;
}

async function refreshRoundSearchCache() {
  const params = buildRoundsParams({ limit: 1000, offset: 0 });
  state.roundSearchCache = await getJson(`/api/rounds?${params}`);
}

async function ensureRoundContextCache() {
  if (!state.roundSearchCache?.items) await refreshRoundSearchCache();
}

function buildRoundsParams({ limit, offset }) {
  const params = new URLSearchParams({ set: "reliable", limit: String(limit), offset: String(offset) });
  params.set("sort", "startAt");
  params.set("order", state.matchesSort === "oldest" ? "asc" : "desc");
  if (state.filters.mode) params.set("mode", state.filters.mode);
  if (state.filters.result) params.set("result", state.filters.result);
  if (state.filters.source) params.set("source", state.filters.source);
  return params;
}

function buildAuditRoundsPath() {
  const params = new URLSearchParams({
    set: "reliable",
    result: "unknown",
    limit: String(state.auditPageSize),
    offset: String(Math.max(0, state.auditPage) * state.auditPageSize),
  });
  params.set("sort", "startAt");
  params.set("order", "desc");
  if (state.auditFilters.mode) params.set("mode", state.auditFilters.mode);
  if (state.auditFilters.priority) params.set("unknownReviewPriority", state.auditFilters.priority);
  if (state.auditFilters.category) params.set("unknownAuditCategory", state.auditFilters.category);
  if (state.auditFilters.nextAction) params.set("unknownNextAction", state.auditFilters.nextAction);
  return `/api/rounds?${params}`;
}

async function refreshAuditData(options = {}) {
  if (options.resetPage) state.auditPage = 0;
  const [results, auditRounds, rulePacks, userRulePacks, rulesReport, rulesDoctor, rulesAudit] = await Promise.all([
    getOptionalJson("/api/results", null),
    getOptionalJson(buildAuditRoundsPath(), { total: 0, items: [] }),
    getOptionalJson("/api/rule-packs", null),
    getOptionalJson("/api/rule-packs/user", null),
    getOptionalJson("/api/rules", null),
    getOptionalJson("/api/rules/doctor", null),
    getOptionalJson("/api/rules/audit", null),
  ]);
  state.results = results;
  state.auditRounds = auditRounds;
  state.rulePacks = rulePacks;
  state.userRulePacks = userRulePacks;
  state.rulesReport = rulesReport;
  state.rulesDoctor = rulesDoctor;
  state.rulesAudit = rulesAudit;
  const activeKey = state.activeAuditRoundKey;
  if (!activeKey || !(auditRounds.items ?? []).some((round) => auditRoundKey(round) === activeKey)) {
    state.activeAuditRoundKey = auditRounds.items?.[0] ? auditRoundKey(auditRounds.items[0]) : "";
  }
}

function resetAuditOutputs() {
  state.auditStatus = null;
  state.auditValidation = null;
  state.auditWorkflow = null;
}

function resetRuleToolOutputs() {
  state.auditRuleTest = null;
  state.auditRuleDraft = null;
  state.auditRuleValidation = null;
  state.auditRuleDryRun = null;
  state.auditRulePackSave = null;
}

function auditReviewRows() {
  return Object.entries(state.auditLabels)
    .map(([key, draft]) => ({
      key,
      round: findAuditRound(key),
      roundRefSeed: draft.roundRefSeed,
      draft,
    }))
    .filter(({ key, draft }) => key && draft?.label)
    .map(({ key, round, roundRefSeed, draft }) => ({
      key,
      roundRefSeed,
      roundRef: auditRoundRef(round) ?? key,
      reviewLabel: draft.label || "",
      reviewNotes: draft.notes || "",
      message: draft.message || "",
      ruleId: draft.ruleId || "",
      confidence: draft.confidence || "",
      negativeExamples: [],
    }));
}

async function auditReviewRowsForApi() {
  const rows = [];
  for (const row of auditReviewRows()) {
    rows.push({
      ...row,
      roundRef: await auditRoundRefForApi(row.round ?? row.roundRefSeed ?? findAuditRound(row.key)),
    });
  }
  return rows.map(({ key, round, roundRefSeed, ...row }) => row);
}

async function runAuditStatus() {
  state.auditBusy = true;
  renderMainRegion();
  try {
    const rows = await auditReviewRowsForApi();
    state.auditStatus = await postJson("/api/unknown-audit/status", { rows });
    showToast(auditCopy("statusUpdated"), "success");
  } catch (error) {
    showToast(error.message || auditCopy("statusFailed"), "error");
  } finally {
    state.auditBusy = false;
    renderMainRegion();
  }
}

async function runAuditValidation() {
  state.auditBusy = true;
  renderMainRegion();
  try {
    const rows = await auditReviewRowsForApi();
    state.auditValidation = await postJson("/api/unknown-audit/labels", { rows });
    showToast(auditCopy("validationUpdated"), "success");
  } catch (error) {
    showToast(error.message || auditCopy("validationFailed"), "error");
  } finally {
    state.auditBusy = false;
    renderMainRegion();
  }
}

async function runAuditWorkflow() {
  state.auditBusy = true;
  renderMainRegion();
  try {
    const draftRows = auditReviewRows();
    const rows = await auditReviewRowsForApi();
    const targetMode = state.auditFilters.mode || draftRows.map((row) => row.round?.gameMode).find(Boolean) || "bedwars";
    state.auditWorkflow = await postJson("/api/rules/audit-workflow", { targetMode, rows });
    showToast(auditCopy("workflowUpdated"), "success");
  } catch (error) {
    showToast(error.message || auditCopy("workflowFailed"), "error");
  } finally {
    state.auditBusy = false;
    renderMainRegion();
  }
}

async function refreshRuleData() {
  const [rulePacks, userRulePacks, rulesReport, rulesDoctor, rulesAudit] = await Promise.all([
    getOptionalJson("/api/rule-packs", null),
    getOptionalJson("/api/rule-packs/user", null),
    getOptionalJson("/api/rules", null),
    getOptionalJson("/api/rules/doctor", null),
    getOptionalJson("/api/rules/audit", null),
  ]);
  state.rulePacks = rulePacks;
  state.userRulePacks = userRulePacks;
  state.rulesReport = rulesReport;
  state.rulesDoctor = rulesDoctor;
  state.rulesAudit = rulesAudit;
}

async function runRuleTest() {
  const message = state.auditRuleMessage.trim();
  if (!message) {
    showToast(auditCopy("messageRequired"), "error");
    return;
  }
  state.auditBusy = true;
  renderMainRegion();
  try {
    state.auditRuleTest = await postJson("/api/rules/test", { message });
    showToast(auditCopy("ruleTested"), "success");
  } catch (error) {
    showToast(error.message || auditCopy("ruleTestFailed"), "error");
  } finally {
    state.auditBusy = false;
    renderMainRegion();
  }
}

async function runRuleDraft() {
  const message = state.auditRuleMessage.trim();
  if (!message) {
    showToast(auditCopy("messageRequired"), "error");
    return;
  }
  state.auditBusy = true;
  renderMainRegion();
  try {
    state.auditRuleDraft = await postJson("/api/rules/draft", {
      message,
      type: state.auditRuleType || "round_end",
      gameMode: state.auditRuleMode || "bedwars",
    });
    showToast(auditCopy("ruleDrafted"), "success");
  } catch (error) {
    showToast(error.message || auditCopy("ruleDraftFailed"), "error");
  } finally {
    state.auditBusy = false;
    renderMainRegion();
  }
}

async function validateRulePackJson() {
  const rulePack = parseRulePackDraft();
  if (!rulePack) return;
  state.auditBusy = true;
  renderMainRegion();
  try {
    state.auditRuleValidation = await postJson("/api/rules/validate", rulePack);
    showToast(auditCopy("rulePackValidated"), "success");
  } catch (error) {
    state.auditRuleValidation = error.detail ?? { ok: false, message: error.message };
    showToast(error.message || auditCopy("rulePackValidationFailed"), "error");
  } finally {
    state.auditBusy = false;
    renderMainRegion();
  }
}

async function dryRunRulePackJson() {
  const rulePack = parseRulePackDraft();
  if (!rulePack) return;
  state.auditBusy = true;
  renderMainRegion();
  try {
    state.auditRuleDryRun = await postJson("/api/rules/dry-run", {
      rulePack,
      targetMode: state.auditRuleMode || "bedwars",
    });
    await refreshRuleData();
    showToast(auditCopy("rulePackDryRunDone"), "success");
  } catch (error) {
    state.auditRuleDryRun = error.detail ?? { ok: false, message: error.message };
    showToast(error.message || auditCopy("rulePackDryRunFailed"), "error");
  } finally {
    state.auditBusy = false;
    renderMainRegion();
  }
}

async function saveRulePackJson() {
  const rulePack = parseRulePackDraft();
  if (!rulePack) return;
  state.auditBusy = true;
  renderMainRegion();
  try {
    state.auditRulePackSave = await postJson("/api/rule-packs/user", rulePack);
    await refreshRuleData();
    showToast(auditCopy("rulePackSaved"), "success");
  } catch (error) {
    state.auditRulePackSave = error.detail ?? { ok: false, message: error.message };
    showToast(error.message || auditCopy("rulePackSaveFailed"), "error");
  } finally {
    state.auditBusy = false;
    renderMainRegion();
  }
}

async function loadUserRulePack(id) {
  if (!id) return;
  state.auditBusy = true;
  renderMainRegion();
  try {
    const detail = await getJson(`/api/rule-packs/user/${encodeURIComponent(id)}`);
    state.auditRulePackDetail = detail;
    state.auditSelectedUserRulePackId = detail.id ?? id;
    if (detail.rulePack) state.auditRulePackJson = JSON.stringify(detail.rulePack, null, 2);
    showToast(auditCopy("rulePackLoaded"), "success");
  } catch (error) {
    showToast(error.message || auditCopy("rulePackLoadFailed"), "error");
  } finally {
    state.auditBusy = false;
    renderMainRegion();
  }
}

async function toggleUserRulePack(id, enabled) {
  if (!id) return;
  state.auditBusy = true;
  renderMainRegion();
  try {
    state.auditRulePackDetail = await postJson("/api/rule-packs/user/enable", { id, enabled });
    await refreshRuleData();
    showToast(enabled ? auditCopy("rulePackEnabled") : auditCopy("rulePackDisabled"), "success");
  } catch (error) {
    showToast(error.message || auditCopy("rulePackToggleFailed"), "error");
  } finally {
    state.auditBusy = false;
    renderMainRegion();
  }
}

async function loadUserRulePackBackups(id) {
  state.auditBusy = true;
  renderMainRegion();
  try {
    state.auditRuleBackups = await postJson("/api/rule-packs/user/backups", id ? { id } : {});
    state.auditSelectedUserRulePackId = id || state.auditSelectedUserRulePackId;
    showToast(auditCopy("ruleBackupsLoaded"), "success");
  } catch (error) {
    showToast(error.message || auditCopy("ruleBackupsFailed"), "error");
  } finally {
    state.auditBusy = false;
    renderMainRegion();
  }
}

async function restoreUserRulePackBackup(id, backupId) {
  if (!id || !backupId) return;
  state.auditBusy = true;
  renderMainRegion();
  try {
    state.auditRulePackDetail = await postJson("/api/rule-packs/user/restore", { id, backupId });
    await refreshRuleData();
    showToast(auditCopy("ruleBackupRestored"), "success");
  } catch (error) {
    showToast(error.message || auditCopy("ruleBackupRestoreFailed"), "error");
  } finally {
    state.auditBusy = false;
    renderMainRegion();
  }
}

async function deleteUserRulePack(id) {
  if (!id) return;
  state.auditBusy = true;
  renderMainRegion();
  try {
    state.auditRulePackDetail = await deleteJson(`/api/rule-packs/user/${encodeURIComponent(id)}`);
    if (state.auditSelectedUserRulePackId === id) state.auditSelectedUserRulePackId = "";
    await refreshRuleData();
    showToast(auditCopy("rulePackDeleted"), "success");
  } catch (error) {
    showToast(error.message || auditCopy("rulePackDeleteFailed"), "error");
  } finally {
    state.auditBusy = false;
    renderMainRegion();
  }
}

function parseRulePackDraft() {
  try {
    return JSON.parse(state.auditRulePackJson || "{}");
  } catch (error) {
    state.auditRuleValidation = { ok: false, message: error.message };
    showToast(auditCopy("invalidJson"), "error");
    renderMainRegion();
    return null;
  }
}

function resetRoundPaging() {
  state.matchesPage = 0;
  state.expandedRoundKey = "";
  state.activeTapeRoundKey = "";
  state.activeRoundDetail = null;
  state.roundSearchCache = null;
}

function buildRecentRounds(primary = {}, fallback = {}) {
  const rows = [
    ...(primary.items ?? []),
    ...(fallback.items ?? []),
  ];
  const uniqueRows = new Map();
  for (const round of rows) {
    const key = round.key ?? `${round.source ?? ""}\u0000${round.scope ?? ""}\u0000${round.startAt ?? ""}\u0000${round.endAt ?? ""}\u0000${round.gameMode ?? ""}\u0000${round.result ?? ""}`;
    if (!uniqueRows.has(key)) uniqueRows.set(key, round);
  }
  const items = [...uniqueRows.values()]
    .sort((a, b) => roundSortTime(b) - roundSortTime(a))
    .slice(0, Math.max(Number(primary.limit ?? 0), 80));
  return {
    ...primary,
    total: fallback.total ?? primary.total ?? items.length,
    offset: 0,
    limit: items.length,
    items,
  };
}

function roundSortTime(round = {}) {
  const date = safeDate(round.endAt ?? round.startAt);
  return date ? date.getTime() : 0;
}

function sortMatchesByTime(rounds = [], sort = state.matchesSort) {
  const direction = sort === "oldest" ? 1 : -1;
  return [...rounds].sort((a, b) => {
    const timeDiff = (roundSortTime(a) - roundSortTime(b)) * direction;
    if (timeDiff) return timeDiff;
    return String(a.key ?? "").localeCompare(String(b.key ?? ""));
  });
}

async function startRefresh(options = {}) {
  state.refresh = {
    running: true,
    startedAt: new Date().toISOString(),
    log: [t("refresh.startingLog")],
  };
  showToast(t("refresh.started"), "info");
  if (options.setup || state.setupMode) renderSetup();
  else renderMainRegion();

  try {
    const response = await postJson("/api/refresh");
    state.refresh = response.refresh ?? response;
    if (isCompletedRefreshSuccess(state.refresh)) {
      state.refresh = null;
      await boot();
      showToast(t("refresh.completed"), "success");
      return;
    }
    if (state.setupMode) state.appStatus = await getJson("/api/app/status");
    if (options.setup || state.setupMode) renderSetup();
    else render();
    scheduleRefreshPoll();
  } catch (error) {
    state.refresh = {
      running: false,
      error: error.message,
      log: [t("refresh.requestFailedLog")],
    };
    showToast(t("refresh.requestFailed"), "error");
    if (options.setup || state.setupMode) renderSetup();
    else renderMainRegion();
  }
}

function scheduleRefreshPoll() {
  window.clearTimeout(refreshTimer);
  if (!state.refresh?.running) return;

  refreshTimer = window.setTimeout(async () => {
    try {
      state.refresh = await getJson("/api/refresh");
      if (state.setupMode) state.appStatus = await getJson("/api/app/status");
      if (isCompletedRefreshSuccess(state.refresh)) {
        state.refresh = null;
        await boot();
        showToast(t("refresh.completed"), "success");
        return;
      }
      if (state.setupMode) renderSetup();
      else renderMainRegion();
      scheduleRefreshPoll();
    } catch (error) {
      state.refresh = {
        running: false,
        error: error.message,
        log: [t("refresh.readFailedLog")],
      };
      showToast(t("refresh.readFailed"), "error");
      if (state.setupMode) renderSetup();
      else renderMainRegion();
    }
  }, 1800);
}

function refreshExitFailed(refresh) {
  const rawExitCode = refresh?.exitCode;
  if (rawExitCode === undefined || rawExitCode === null || rawExitCode === "") return false;
  const exitCode = Number(rawExitCode);
  return Number.isNaN(exitCode) ? true : exitCode !== 0;
}

function isCompletedRefreshSuccess(refresh) {
  return Boolean(refresh) && !refresh.running && !refresh.error && !refreshExitFailed(refresh);
}

function visibleRefresh(refresh) {
  if (!refresh) return null;
  if (refresh.running || refresh.error || refreshExitFailed(refresh)) return refresh;
  return null;
}

async function getJson(path) {
  const response = await apiFetch(path);
  if (!response.ok) {
    let detail = null;
    try {
      detail = await response.json();
    } catch {
      // Keep the fallback status message when the API did not return JSON.
    }
    const error = new Error(detail?.message || `${path} returned ${response.status}`);
    error.status = response.status;
    error.code = detail?.error;
    throw error;
  }
  return response.json();
}

async function getOptionalJson(path, fallback = null) {
  try {
    return await getJson(path);
  } catch {
    return fallback;
  }
}

async function postJson(path, body = {}) {
  const response = await apiFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw await apiRequestError(path, response);
  return response.json();
}

async function putJson(path, body = {}) {
  const response = await apiFetch(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw await apiRequestError(path, response);
  return response.json();
}

async function deleteJson(path) {
  const response = await apiFetch(path, { method: "DELETE" });
  if (!response.ok) throw await apiRequestError(path, response);
  return response.json();
}

async function apiFetch(path, options = {}) {
  const invoke = window.__TAURI__?.core?.invoke;
  if (invoke && typeof path === "string" && path.startsWith("/api/")) {
    const response = await invoke("api_request", {
      request: {
        method: options.method ?? "GET",
        url: path,
        body: parseRequestBody(options.body),
      },
    });
    return tauriApiResponse(response);
  }
  return fetch(path, options);
}

function parseRequestBody(body) {
  if (body === undefined || body === null || body === "") return {};
  if (typeof body !== "string") return body;
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

function tauriApiResponse(response) {
  const status = response?.status ?? 500;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: response?.headers ?? {},
    json: async () => response?.body ?? null,
    text: async () => JSON.stringify(response?.body ?? null),
  };
}

async function apiRequestError(path, response) {
  let detail = null;
  try {
    detail = await response.json();
  } catch {
    // Keep the fallback status message when the API did not return JSON.
  }
  const error = new Error(detail?.message || `${path} returned ${response.status}`);
  error.status = response.status;
  error.code = detail?.error;
  error.detail = detail;
  return error;
}

function renderLoading() {
  applyTheme();
  root.innerHTML = `
    <main class="boot-screen">
      ${pixelMark("large")}
      <strong>${escapeHtml(t("boot.loadingTitle"))}</strong>
      <span>${escapeHtml(t("boot.loadingDetail"))}</span>
    </main>
  `;
}

function themeControl() {
  const options = [
    ["system", "monitor", t("theme.system", {}, "System")],
    ["light", "sun", t("theme.light")],
    ["dark", "moon", t("theme.dark")],
  ];
  const active = state.themePreference || "system";
  return `
    <div class="theme-segmented" role="group" aria-label="${escapeAttribute(t("themeLabel"))}">
      ${options.map(([value, icon, label]) => `
        <button type="button" class="${active === value ? "active" : ""}" data-theme-choice="${escapeAttribute(value)}" aria-pressed="${active === value}" title="${escapeAttribute(label)}">
          ${iconSpan(icon, "theme-icon")}
          <span>${escapeHtml(label)}</span>
        </button>
      `).join("")}
    </div>
  `;
}

function renderError(error) {
  applyTheme();
  root.innerHTML = `
    <main class="boot-screen error">
      ${pixelMark("large")}
      <strong>${escapeHtml(t("boot.errorTitle"))}</strong>
      <span>${escapeHtml(error.message)}</span>
      <code>start.bat</code>
    </main>
  `;
}

function renderSetup() {
  applyTheme();
  document.documentElement.lang = state.locale === "en" ? "en" : "zh-CN";
  root.innerHTML = `
    <main class="oobe-screen">
      <section class="oobe-shell">
        <div class="oobe-copy">
          ${pixelMark("large")}
          <span>${escapeHtml(t("oobe.eyebrow"))}</span>
          <h1>${escapeHtml(t("oobe.title"))}</h1>
          <p>${escapeHtml(t("oobe.summary"))}</p>
          <small>${escapeHtml(t("oobe.firstRunHint"))}</small>
        </div>
        <section class="oobe-card" aria-label="${escapeAttribute(t("oobe.title"))}">
          <div class="oobe-card-head">
            <div class="oobe-card-status">
              <span>${escapeHtml(t("oobe.status"))}</span>
              <strong>${escapeHtml(setupStatusLabel(state.appStatus))}</strong>
            </div>
            <div class="oobe-card-actions">
              <button type="button" class="language-toggle" data-action="switch-locale" aria-label="${escapeAttribute(t("languageLabel"))}" title="${escapeAttribute(t("languageLabel"))}">
                <span>${escapeHtml(state.locale === "en" ? "EN" : "中")}</span>
                <b>${escapeHtml(t("otherLocaleName"))}</b>
              </button>
              ${themeControl()}
            </div>
          </div>
          ${oobeRootForm()}
          ${oobeValidationPanel()}
          ${oobeRefreshPanel()}
        </section>
      </section>
      ${toastRegion()}
    </main>
  `;
  bindSetupInteractions();
}

function oobeRootForm() {
  const busy = state.oobe.picking || state.oobe.validating || state.oobe.saving || state.refresh?.running;
  const configuredRoots = state.appStatus?.project?.roots ?? [];
  return `
    <label class="oobe-root-field">
      <span>${escapeHtml(t("oobe.rootLabel"))}</span>
      <textarea data-oobe-roots rows="4" placeholder="${escapeAttribute(t("oobe.rootPlaceholder"))}" ${busy ? "disabled" : ""}>${escapeHtml(state.oobe.rootText)}</textarea>
      <small>${escapeHtml(t("oobe.manualHint"))}</small>
    </label>
    ${configuredRoots.length ? `
      <div class="oobe-current-roots">
        <span>${escapeHtml(t("oobe.currentRoots"))}</span>
        ${configuredRoots.map((item) => `<code>${escapeHtml(item)}</code>`).join("")}
      </div>
    ` : ""}
    ${state.oobe.error ? `<div class="oobe-message error">${escapeHtml(state.oobe.error)}</div>` : ""}
    ${state.oobe.message ? `<div class="oobe-message success">${escapeHtml(state.oobe.message)}</div>` : ""}
    <div class="oobe-actions">
      <button type="button" class="secondary-action" data-action="choose-log-root" ${busy ? "disabled" : ""}>
        ${state.oobe.picking ? '<span class="spinner-icon" aria-hidden="true"></span>' : iconSpan("folder")}
        <span>${escapeHtml(state.oobe.picking ? t("oobe.choosing") : t("oobe.choose"))}</span>
      </button>
      <button type="button" class="secondary-action" data-action="validate-log-roots" ${busy ? "disabled" : ""}>
        ${state.oobe.validating ? '<span class="spinner-icon" aria-hidden="true"></span>' : iconSpan("shieldCheck")}
        <span>${escapeHtml(state.oobe.validating ? t("oobe.validating") : t("oobe.validate"))}</span>
      </button>
      <button type="button" class="primary-action" data-action="save-log-roots" ${busy ? "disabled" : ""}>
        ${state.oobe.saving ? '<span class="spinner-icon" aria-hidden="true"></span>' : iconSpan("download")}
        <span>${escapeHtml(state.oobe.saving ? t("oobe.saving") : t("oobe.save"))}</span>
      </button>
    </div>
  `;
}

function oobeValidationPanel() {
  const validation = state.oobe.validation;
  if (!validation?.roots?.length) return "";
  return `
    <div class="oobe-validation">
      ${validation.roots.map((item) => `
        <article class="${item.valid ? "valid" : "invalid"}">
          <div>
            <strong>${escapeHtml(item.root ?? item.input ?? t("common.unknown"))}</strong>
            <span>${escapeHtml(item.valid ? t("oobe.validationPassed", { files: formatNumber(item.logFiles), scopes: formatNumber(item.scopes) }) : t("oobe.validationFailed"))}</span>
          </div>
          <b>${escapeHtml(item.valid ? "OK" : "CHECK")}</b>
        </article>
      `).join("")}
    </div>
  `;
}

function oobeRefreshPanel() {
  const setup = state.appStatus?.setup;
  const reasons = setup?.reasons ?? [];
  const needsRefresh = setup?.state === "needs_refresh";
  const refreshing = setup?.state === "refreshing" || state.refresh?.running;
  if (!needsRefresh && !refreshing) return "";
  return `
    <div class="oobe-refresh">
      <div>
        <span>${escapeHtml(t("oobe.refreshReasons"))}</span>
        <strong>${escapeHtml(refreshing ? t("oobe.refreshing") : t("oobe.readyToRefresh"))}</strong>
      </div>
      ${reasons.length ? `<div class="chip-row">${reasons.slice(0, 5).map((reason) => chip(reason)).join("")}</div>` : ""}
      ${refreshing ? oobeRefreshProgress(state.refresh ?? state.appStatus?.refresh) : ""}
      ${refreshStatus(state.refresh ?? state.appStatus?.refresh)}
      <button type="button" class="primary-action" data-action="run-oobe-refresh" ${refreshing ? "disabled" : ""}>
        ${refreshing ? '<span class="spinner-icon" aria-hidden="true"></span>' : iconSpan("refresh")}
        <span>${escapeHtml(refreshing ? t("oobe.refreshing") : t("oobe.refresh"))}</span>
      </button>
    </div>
  `;
}

function oobeRefreshProgress(refresh) {
  if (!refresh?.running) return "";
  const percentValue = clamp(Number(refresh.percent ?? 0), 0, 100);
  const filesDone = Number(refresh.filesDone ?? refresh.files?.done ?? 0);
  const filesTotal = Number(refresh.filesTotal ?? refresh.files?.total ?? 0);
  const elapsedMs = refresh.durationMs ?? refresh.phaseTimings?.[refresh.phase]?.durationMs;
  const phase = refreshPhaseLabel(refresh.phase);
  const fileName = shortPath(refresh.currentFile);
  const fileText = filesTotal > 0
    ? `${formatNumber(filesDone)} / ${formatNumber(filesTotal)} files`
    : (fileName || t("refresh.defaultRunningLine"));
  return `
    <div class="oobe-progress" role="status" aria-live="polite">
      <div class="oobe-progress-head">
        <strong>${escapeHtml(phase)}</strong>
        <b>${escapeHtml(`${Math.round(percentValue)}%`)}</b>
      </div>
      <div class="oobe-progress-track" aria-hidden="true">
        <i style="width:${percentValue}%"></i>
      </div>
      <div class="oobe-progress-meta">
        <span>${escapeHtml(fileText)}</span>
        ${elapsedMs ? `<span>${escapeHtml(formatDurationFromMilliseconds(elapsedMs))}</span>` : ""}
      </div>
      ${fileName ? `<code title="${escapeAttribute(refresh.currentFile)}">${escapeHtml(fileName)}</code>` : ""}
    </div>
  `;
}

function refreshPhaseLabel(phase) {
  const labels = {
    scan: "Scanning logs",
    parse: "Parsing chat",
    build_report: "Building report",
    export_store: "Writing store",
    commit: "Saving results",
    done: "Done",
    idle: "Idle",
  };
  return labels[phase] ?? phase ?? t("refresh.running");
}

function setupStatusLabel(appStatus) {
  const setupState = appStatus?.setup?.state;
  if (setupState === "first_run") return t("oobe.title");
  if (setupState === "needs_refresh") return t("oobe.readyToRefresh");
  if (setupState === "refreshing") return t("oobe.refreshing");
  return t("refresh.done");
}

function render() {
  const view = buildViewModel();
  applyTheme();
  document.documentElement.lang = state.locale === "en" ? "en" : "zh-CN";
  unbindInteractions();

  root.innerHTML = `
    <main class="app-shell">
      ${topBar(view)}
      ${shouldShowFilterRow() ? filterRow(view) : ""}
      <section class="workbench-main" aria-busy="false">
        ${activeView(view)}
      </section>
      ${shouldShowCommandBar() ? commandBar(view) : ""}
      ${profileEditorDialog(view)}
      ${toastRegion()}
      ${tapeTooltipShell()}
    </main>
  `;

  bindInteractions();
}

function renderFrame() {
  const view = buildViewModel();
  applyTheme();
  document.documentElement.lang = state.locale === "en" ? "en" : "zh-CN";
  updateRegion(".topbar", topBar(view), { bind: false });
  updateFilterRowRegion(view);
  updateWorkbenchMain(activeView(view), false);
  updateCommandBarRegion(view);
  updateRegion(".profile-editor-backdrop", profileEditorDialog(view), { bind: false, optional: true });
  updateToastRegion();
  bindInteractions();
}

function renderMainRegion() {
  const view = buildViewModel();
  updateWorkbenchMain(activeView(view), false);
  updateCommandBarRegion(view);
  updateToastRegion();
  bindInteractions();
}

function updateWorkbenchMain(html, pending = false) {
  const target = root.querySelector(".workbench-main");
  if (!target) {
    render();
    return;
  }
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;
  target.setAttribute("aria-busy", String(pending));
  target.innerHTML = html;
  window.scrollTo(scrollX, scrollY);
}

function shouldShowCommandBar() {
  return state.activeTab !== "share" && !state.activeRoundDetail;
}

function shouldShowFilterRow() {
  return state.activeTab === "matches" && !state.activeRoundDetail;
}

function updateFilterRowRegion(view) {
  const html = shouldShowFilterRow() ? filterRow(view) : "";
  const current = root.querySelector(".filter-row");
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;
  if (current) {
    if (html) current.outerHTML = html;
    else current.remove();
    window.scrollTo(scrollX, scrollY);
    return;
  }
  if (!html) return;
  const topbar = root.querySelector(".topbar");
  if (!topbar) {
    render();
    return;
  }
  topbar.insertAdjacentHTML("afterend", html);
  window.scrollTo(scrollX, scrollY);
}

function updateCommandBarRegion(view) {
  const html = shouldShowCommandBar() ? commandBar(view) : "";
  const current = root.querySelector(".command-bar");
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;
  if (current) {
    if (html) current.outerHTML = html;
    else current.remove();
    window.scrollTo(scrollX, scrollY);
    return;
  }
  if (!html) return;
  const main = root.querySelector(".workbench-main");
  if (!main) {
    render();
    return;
  }
  main.insertAdjacentHTML("afterend", html);
  window.scrollTo(scrollX, scrollY);
}

function updateRegion(selector, html, options = {}) {
  const target = root.querySelector(selector);
  if (!target) {
    if (!html || options.optional) return;
    render();
    return;
  }
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;
  if (html) target.outerHTML = html;
  else target.remove();
  window.scrollTo(scrollX, scrollY);
  if (options.bind !== false) bindInteractions();
}

function updateToastRegion() {
  const target = root.querySelector(".toast-region");
  if (target) {
    target.outerHTML = toastRegion();
  } else {
    root.querySelector(".app-shell, .oobe-screen")?.insertAdjacentHTML("beforeend", toastRegion());
  }
}

function tapeTooltipShell() {
  return `<section class="tape-tooltip" aria-live="polite" aria-hidden="true"></section>`;
}

function ensureTapeTooltip() {
  let tooltip = root.querySelector(".tape-tooltip") ?? document.querySelector(".tape-tooltip");
  if (!tooltip) {
    tooltip = document.createElement("section");
    tooltip.className = "tape-tooltip";
    tooltip.setAttribute("aria-live", "polite");
    tooltip.setAttribute("aria-hidden", "true");
    document.body.append(tooltip);
  }
  return tooltip;
}

function hideTapeTooltip() {
  activeTapeTooltipKey = "";
  const tooltip = document.querySelector(".tape-tooltip");
  tooltip?.classList.remove("visible");
  tooltip?.setAttribute("aria-hidden", "true");
  state.activeTapeRoundKey = "";
  root.querySelectorAll("[data-tape-round].active").forEach((button) => {
    button.classList.remove("active");
  });
}

function unbindInteractions() {
  interactionController?.abort();
  interactionController = null;
  hideTapeTooltip();
}

function buildViewModel() {
  const summary = state.summary ?? {};
  const overview = summary.overview ?? {};
  const roundsSummary = summary.rounds ?? {};
  const profile = state.profile ?? summary.profile ?? {};
  const totals = profile.totals ?? {};
  const days = profile.days ?? {};
  const activity = summary.activity ?? {};
  const reliableRecordCount = reliableRecordsCount(overview, roundsSummary);
  const officialMatchCount = resultEligibleCount(overview, roundsSummary);
  const activityRecordCount = notApplicableCount(overview, roundsSummary, reliableRecordCount, officialMatchCount);
  const winStreaks = profile.streaks?.win ?? overview.winStreaks ?? {};
  const selectedWinStreak = selectWinStreak(profile, overview, state.winStreakPolicy);
  const playerMaxKillStreak = playerMaxKillStreakValue(profile, summary);
  const observedBroadcastMaxKillStreak = observedBroadcastMaxKillStreakValue(profile, summary);
  const owner = state.accounts?.owner ?? summary.accounts?.owner ?? {};
  const accountRows = state.accountPlaytime?.items ?? summary.accounts?.topPlaytimeUsers ?? [];
  const serverIdentityRows = buildServerIdentityRows(state.identityRounds?.items ?? state.recentRounds?.items ?? state.rounds?.items ?? [], state.identityActivity?.items ?? []);
  const serverRoundRows = state.identityRounds?.items ?? state.recentRounds?.items ?? state.rounds?.items ?? [];
  const serverRows = buildServerRows(serverRoundRows, serverRoundRows.length ? [] : state.identityActivity?.items ?? []);
  const modes = modeRowsFromApi(state.modesData, roundsSummary).sort((a, b) => (b.rounds ?? 0) - (a.rounds ?? 0));
  const topModes = modes.slice(0, 8);
  const overviewTopModes = sortOverviewModes(modes, state.overviewModeSort).slice(0, 8);
  const sources = unique((summary.topScopes ?? []).map((scope) => scope.source));
  const sourceLabel = sources.join(" / ") || t("common.localLogs");
  const calendarGraph = buildContributionCalendar(state.daySeries?.items ?? [], state.heatmapWindowIndex);
  const clientRows = (summary.topScopes ?? []).slice(0, 6);
  const overviewClientRows = sortOverviewSources(summary.topScopes ?? [], state.overviewSourceSort).slice(0, 6);
  const overviewServerRows = sortServerRows(serverRows, state.overviewServerSort).slice(0, 6);
  const auditItems = state.auditRounds?.items ?? [];
  const activeAuditRound = findAuditRound(state.activeAuditRoundKey) ?? auditItems[0] ?? null;
  const diagnostics = {
    reliable: roundsSummary.reliableRounds ?? 0,
    unknown: overview.unknownResults ?? 0,
    ignored: roundsSummary.ignoredRounds ?? 0,
  };

  return {
    summary,
    overview,
    roundsSummary,
    reliableRecordCount,
    officialMatchCount,
    activityRecordCount,
    reliableRecordSummary: reliableRecordSummary(officialMatchCount, activityRecordCount, reliableRecordCount),
    profile,
    totals,
    days,
    owner,
    accountRows,
    serverIdentityRows,
    serverRows,
    candidateRows: state.candidates?.items ?? [],
    audit: {
      results: state.results,
      rounds: state.auditRounds ?? { total: 0, items: [] },
      items: auditItems,
      activeRound: activeAuditRound,
      rulePacks: state.rulePacks,
      userRulePacks: state.userRulePacks,
      rulesReport: state.rulesReport,
      rulesDoctor: state.rulesDoctor,
      rulesAudit: state.rulesAudit,
      reviewRows: auditReviewRows(),
    },
    recentRounds: state.recentRounds?.items ?? state.rounds?.items ?? [],
    matchesTotal: state.rounds?.total ?? 0,
    matchesOffset: state.rounds?.offset ?? 0,
    matchesLimit: state.rounds?.limit ?? state.matchesPageSize,
    playerName: pickDisplayName(owner, accountRows, state.playerProfile),
    identityCount: serverIdentityRows.length || totals.localUserCount || owner.localUserCount || accountRows.length,
    serverIdentityCount: serverIdentityRows.length,
    serverIdentityEvidence: serverIdentityRows.reduce((total, row) => total + Number(row.evidence ?? 0), 0),
    serverIdentityRounds: serverIdentityRows.reduce((total, row) => total + Number(row.rounds ?? 0), 0),
    serverCount: serverRows.length,
    aliasCount: owner.aliases?.length ?? summary.accounts?.aliases ?? 0,
    sourceLabel,
    sources,
    modeIds: modes.map((mode) => mode.id),
    modes,
    topModes,
    maxModeRounds: Math.max(...topModes.map((mode) => mode.rounds ?? 0), 1),
    overviewTopModes,
    maxOverviewModeScore: Math.max(...overviewTopModes.map((mode) => overviewModeScore(mode, state.overviewModeSort)), 1),
    clientRows,
    overviewClientRows,
    overviewServerRows,
    calendarGraph,
    diagnostics,
    streaks: {
      win: winStreaks,
      selectedWin: selectedWinStreak,
      selectedWinPolicy: state.winStreakPolicy,
      playerMaxKillStreak,
      observedBroadcastMaxKillStreak,
    },
    activity: {
      duration: activity.duration ?? totals.pitDuration ?? "0s",
      observedBroadcastMaxKillStreak,
      playerMaxKillStreak,
      kills: activity.kills ?? 0,
      selfKills: activity.selfKills ?? 0,
    },
    refresh: state.refresh,
  };
}

function selectWinStreak(profile = {}, overview = {}, policy = "breakUnknown") {
  const win = profile.streaks?.win ?? overview.winStreaks ?? {};
  const selectedPolicy = policy === "skipUnknown" ? "skipUnknown" : "breakUnknown";
  const aliases = { breakUnknown: "break_unknown", skipUnknown: "skip_unknown" };
  const selected = win[selectedPolicy] ?? win[aliases[selectedPolicy] ?? camelToSnake(selectedPolicy)];
  const fallback = win.breakUnknown
    ?? win.break_unknown
    ?? {
      best: { count: overview.bestWinStreak ?? profile.totals?.bestWinStreak ?? 0 },
      current: { count: overview.currentWinStreak ?? profile.totals?.currentWinStreak ?? 0 },
    };
  return normalizeStreakCounts(selected ?? fallback);
}

function normalizeStreakCounts(streak = {}) {
  return {
    ...streak,
    best: {
      ...(streak.best ?? {}),
      count: Number(streak.best?.count ?? 0),
    },
    current: {
      ...(streak.current ?? {}),
      count: Number(streak.current?.count ?? 0),
    },
  };
}

function playerMaxKillStreakValue(profile = {}, summary = {}) {
  return Number(
    profile.streaks?.playerMaxKillStreak?.count
    ?? profile.totals?.playerMaxKillStreak
    ?? summary.overview?.playerMaxKillStreak
    ?? 0,
  );
}

function observedBroadcastMaxKillStreakValue(profile = {}, summary = {}) {
  const totals = profile.totals ?? summary.profile?.totals ?? {};
  const activity = summary.activity ?? {};
  return Number(
    activity.observedBroadcastMaxKillStreak
    ?? totals.pitObservedBroadcastMaxKillStreak
    ?? activity.maxStreak
    ?? totals.pitMaxStreak
    ?? 0,
  );
}

function modeRowsFromApi(modesData = {}, roundsSummary = {}) {
  const source = modesData?.items && typeof modesData.items === "object"
    ? modesData.items
    : roundsSummary.gameModes ?? {};
  return Object.values(source).map(normalizeModeRow);
}

function normalizeModeRow(mode = {}) {
  const durationSeconds = modeDurationSeconds(mode);
  const selfKills = Number(mode.selfKills ?? 0);
  const selfDeaths = Number(mode.selfDeaths ?? 0);
  const observedKills = Number(mode.kills ?? 0);
  const observedDeaths = Number(mode.deaths ?? 0);
  const playerBedDestroys = Number(mode.playerBedDestroys ?? mode.selfBedDestroys ?? 0);
  const observedBedDestroys = Number(mode.bedDestroys ?? 0);
  const wins = Number(mode.wins ?? 0);
  const losses = Number(mode.losses ?? 0);
  const knownResults = wins + losses;
  return {
    ...mode,
    id: mode.id ?? mode.key ?? mode.mode ?? "unknown",
    label: mode.label ?? mode.id ?? mode.key ?? t("common.unknown"),
    rounds: Number(mode.rounds ?? mode.reliableRounds ?? mode.total ?? 0),
    durationSeconds,
    duration: mode.duration ?? mode.playtime ?? formatDurationFromSeconds(durationSeconds),
    selfKills,
    selfDeaths,
    observedKills,
    observedDeaths,
    kills: observedKills,
    deaths: observedDeaths,
    playerBedDestroys,
    observedBedDestroys,
    bedDestroys: observedBedDestroys,
    wins,
    losses,
    unknownResults: Number(mode.unknownResults ?? mode.unknown_results ?? 0),
    winRate: Number.isFinite(Number(mode.winRate)) ? Number(mode.winRate) : (knownResults ? wins / knownResults : 0),
    resultEligible: mode.resultEligible ?? mode.result_eligible ?? null,
    notApplicableResults: Number(mode.notApplicableResults ?? mode.not_applicable_results ?? 0),
  };
}

function reliableRecordsCount(overview = {}, roundsSummary = {}) {
  return finiteNumber(overview.reliableRounds, roundsSummary.reliableRounds, roundsSummary.total);
}

function resultEligibleCount(overview = {}, roundsSummary = {}) {
  const explicit = finiteNumber(
    overview.resultEligibleRounds,
    overview.result_eligible_rounds,
    roundsSummary.resultEligibleRounds,
    roundsSummary.result_eligible_rounds,
  );
  if (explicit > 0) return explicit;
  const wins = finiteNumber(overview.wins, roundsSummary.wins);
  const losses = finiteNumber(overview.losses, roundsSummary.losses);
  const unknown = finiteNumber(overview.unknownResults, roundsSummary.unknownResults);
  return wins + losses + unknown;
}

function notApplicableCount(overview = {}, roundsSummary = {}, reliable = reliableRecordsCount(overview, roundsSummary), eligible = resultEligibleCount(overview, roundsSummary)) {
  const explicit = finiteNumber(
    overview.notApplicableResults,
    overview.not_applicable_results,
    roundsSummary.notApplicableResults,
    roundsSummary.not_applicable_results,
  );
  if (explicit > 0) return explicit;
  return Math.max(0, reliable - eligible);
}

function reliableRecordSummary(matches, activities, reliable) {
  if (matches > 0 && activities > 0) {
    return t("overview.reliableRecordBreakdown", { matches: formatNumber(matches), activities: formatNumber(activities) });
  }
  if (matches > 0) return t("overview.roundCount", { count: formatNumber(matches) });
  if (activities > 0) return t("overview.activityCount", { count: formatNumber(activities) });
  return t("overview.recordCount", { count: formatNumber(reliable) });
}

function isActivityMode(mode = {}) {
  const eligible = mode.resultEligible ?? mode.result_eligible;
  if (eligible === false || eligible === 0 || eligible === "0" || eligible === "false") return true;
  const knownResults = finiteNumber(mode.wins) + finiteNumber(mode.losses) + finiteNumber(mode.unknownResults);
  return finiteNumber(mode.notApplicableResults, mode.not_applicable_results) > 0 && knownResults === 0;
}

function modeCountLabel(mode = {}, count = Number(mode.rounds ?? 0)) {
  return isActivityMode(mode)
    ? t("overview.activityCount", { count: formatNumber(count) })
    : t("overview.roundCount", { count: formatNumber(count) });
}

function modeUnitMetricLabel(mode = {}) {
  return isActivityMode(mode) ? t("modes.activities") : t("modes.rounds");
}

function modeKillsSummary(mode = {}, count = Number(mode.rounds ?? 0), kills = modeSelfKills(mode)) {
  return isActivityMode(mode)
    ? t("overview.activitiesKills", { segments: formatNumber(count), kills: formatNumber(kills) })
    : t("overview.roundsKills", { rounds: formatNumber(count), kills: formatNumber(kills) });
}

function buildServerRows(rounds = [], activitySegments = []) {
  const rows = new Map();
  for (const round of rounds) {
    addServerRow(rows, round, { isActivity: round.result === "not_applicable" || round.resultEligible === false });
  }
  for (const segment of activitySegments) {
    addServerRow(rows, segment, { isActivity: true });
  }
  return [...rows.values()]
    .map((row) => ({
      ...row,
      modes: [...row.modes].sort((a, b) => Number(b[1]) - Number(a[1]) || modeLabel(a[0]).localeCompare(modeLabel(b[0]), localeCode(), { sensitivity: "base" })),
      networks: [...row.networks].sort(),
      addresses: [...row.addresses].sort(),
      confidenceLevels: [...row.confidenceLevels].sort(),
      duration: formatDurationFromSeconds(row.durationSeconds),
      winRate: row.wins + row.losses ? row.wins / (row.wins + row.losses) : 0,
    }))
    .sort((a, b) => b.records - a.records || b.durationSeconds - a.durationSeconds || a.label.localeCompare(b.label, localeCode(), { numeric: true, sensitivity: "base" }));
}

function addServerRow(rows, item = {}, options = {}) {
  const label = serverLabelValue(item);
  if (!label) return;
  const row = getGroup(rows, label, () => ({
    label,
    records: 0,
    rounds: 0,
    activities: 0,
    durationSeconds: 0,
    selfKills: 0,
    selfDeaths: 0,
    wins: 0,
    losses: 0,
    unknown: 0,
    notApplicable: 0,
    modes: new Map(),
    networks: new Set(),
    addresses: new Set(),
    confidenceLevels: new Set(),
  }));
  const isActivity = Boolean(options.isActivity);
  const mode = item.gameMode || item.mode || "unknown";
  row.records += 1;
  row.durationSeconds += Number(item.durationSeconds ?? 0);
  row.selfKills += playerSelfKills(item);
  row.selfDeaths += playerSelfDeaths(item);
  row.modes.set(mode, (row.modes.get(mode) ?? 0) + 1);
  if (item.serverNetwork) row.networks.add(String(item.serverNetwork));
  if (item.serverAddress) row.addresses.add(String(item.serverAddress));
  if (item.serverConfidence) row.confidenceLevels.add(String(item.serverConfidence));
  if (isActivity || item.result === "not_applicable") {
    row.activities += 1;
    row.notApplicable += 1;
  } else {
    row.rounds += 1;
    if (item.result === "win") row.wins += 1;
    else if (item.result === "loss") row.losses += 1;
    else row.unknown += 1;
  }
}

function serverLabelValue(row = {}) {
  const label = row.serverLabel ?? row.serverName ?? row.serverNetwork ?? row.serverAddress;
  const text = displayScope(label).trim();
  return text && text !== missingValue() ? text : "";
}

function sortServerRows(rows = [], sort = "duration") {
  const normalizedSort = sort === "name" ? "name" : "duration";
  return [...rows].sort((a, b) => {
    if (normalizedSort === "name") {
      return a.label.localeCompare(b.label, localeCode(), { numeric: true, sensitivity: "base" })
        || b.records - a.records
        || b.durationSeconds - a.durationSeconds;
    }
    return b.durationSeconds - a.durationSeconds
      || b.records - a.records
      || a.label.localeCompare(b.label, localeCode(), { numeric: true, sensitivity: "base" });
  });
}

function topServerForMode(mode = {}, serverRows = []) {
  const modeId = mode.id ?? mode.mode ?? mode.key;
  if (!modeId) return null;
  return serverRows
    .map((server) => ({
      ...server,
      modeRecords: Number(server.modes.find(([id]) => id === modeId)?.[1] ?? 0),
    }))
    .filter((server) => server.modeRecords > 0)
    .sort((a, b) => b.modeRecords - a.modeRecords || b.durationSeconds - a.durationSeconds || a.label.localeCompare(b.label, localeCode(), { numeric: true, sensitivity: "base" }))[0] ?? null;
}

function serverCopy(key, vars = {}) {
  const labels = {
    zh: {
      coverage: "\u670d\u52a1\u5668\u8986\u76d6",
      count: "{count} \u4e2a\u670d\u52a1\u5668",
      noData: "\u6ca1\u6709\u53ef\u5c55\u793a\u7684\u670d\u52a1\u5668\u8bb0\u5f55\u3002",
      sort: "\u670d\u52a1\u5668\u8986\u76d6\u6392\u5e8f",
      sortByName: "\u6309\u540d\u79f0",
      sortByActivity: "\u6309\u6d3b\u8dc3",
      mainServer: "\u4e3b\u8981\u670d\u52a1\u5668",
      records: "{records} \u6761\u8bb0\u5f55",
      rounds: "{rounds} \u573a",
      activities: "{activities} \u6bb5\u6d3b\u52a8",
      serverMix: "\u670d\u52a1\u5668\u5206\u5e03",
    },
    en: {
      coverage: "Server coverage",
      count: "{count} servers",
      noData: "No server records to display.",
      sort: "Server coverage sort",
      sortByName: "By name",
      sortByActivity: "By activity",
      mainServer: "Main server",
      records: "{records} records",
      rounds: "{rounds} matches",
      activities: "{activities} segments",
      serverMix: "Server mix",
    },
  };
  const value = labels[state.locale === "en" ? "en" : "zh"][key] ?? key;
  return value.replace(/\{(\w+)\}/g, (_, name) => vars[name] ?? "");
}

function camelToSnake(value) {
  return String(value).replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

function topBar(view) {
  const tabs = [
    ["overview", t("tabs.overview")],
    ["matches", t("tabs.matches")],
    ["modes", t("tabs.modes")],
    ["identity", t("tabs.identity")],
    ["share", t("tabs.share")],
    ["audit", t("tabs.audit")],
  ];

  return `
    <header class="topbar">
      <div class="topbar-inner">
        <a class="brand" href="#overview" aria-label="MC Log Analytics">
          ${pixelMark()}
          <span>MC Log Analytics</span>
          <b>${escapeHtml(t("localBadge"))}</b>
        </a>

        <nav class="top-tabs" aria-label="${escapeAttribute(t("aria.workspaceViews"))}">
          ${tabs.map(([id, label]) => `
            <button type="button" class="${state.activeTab === id ? "active" : ""}" data-tab="${id}" aria-current="${state.activeTab === id ? "page" : "false"}">
              ${escapeHtml(label)}
            </button>
          `).join("")}
        </nav>

        <div class="top-actions">
          <button type="button" class="language-toggle" data-action="switch-locale" aria-label="${escapeAttribute(t("languageLabel"))}" title="${escapeAttribute(t("languageLabel"))}">
            <span>${escapeHtml(state.locale === "en" ? "EN" : "中")}</span>
            <b>${escapeHtml(t("otherLocaleName"))}</b>
          </button>
          ${themeControl()}
          <button type="button" class="icon-btn" title="${escapeAttribute(t("actions.refreshReport"))}" aria-label="${escapeAttribute(t("actions.refreshReport"))}" data-action="refresh-report" ${view.refresh?.running ? "disabled" : ""}>
            ${iconSpan("refresh")}
          </button>
          <button type="button" class="icon-btn" title="${escapeAttribute(t("actions.exportShareCard"))}" aria-label="${escapeAttribute(t("actions.exportShareCard"))}" data-action="open-share" data-share-kind-target="${escapeAttribute(shareKindForTab(state.activeTab))}">
            ${iconSpan("share")}
          </button>
        </div>
      </div>
      ${refreshStatus(view.refresh)}
    </header>
  `;
}

function filterRow(view) {
  const resultFilters = [
    ["", t("common.all")],
    ["win", t("common.wins")],
    ["loss", t("common.losses")],
    ["unknown", t("common.unknown")],
  ];
  const activeFilterCount = [state.filters.result, state.filters.mode, state.filters.source, state.query.trim()].filter(Boolean).length;

  return `
    <section class="filter-row" aria-label="${escapeAttribute(t("aria.globalFilters"))}">
      <label class="search-box">
        ${iconSpan("search", "search-icon")}
        <input type="search" name="match-search" autocomplete="off" data-query value="${escapeAttribute(state.query)}" placeholder="${escapeAttribute(t("filters.searchPlaceholder"))}" aria-label="${escapeAttribute(t("aria.searchMatches"))}" />
      </label>

      <div class="divider"></div>

      <div class="result-filter" aria-label="${escapeAttribute(t("aria.resultFilter"))}">
        ${resultFilters.map(([value, label]) => `
          <button type="button" class="${state.filters.result === value ? "active" : ""} ${value || "all"}" data-result-filter="${escapeAttribute(value)}">
            ${escapeHtml(label)}
          </button>
        `).join("")}
      </div>

      <div class="divider"></div>

      ${filterSelect("mode", ["", ...view.modeIds], state.filters.mode, t("filters.allModes"))}
      ${filterSelect("source", ["", ...view.sources], state.filters.source, t("filters.allSources"))}

      <div class="filter-spacer"></div>

      <button type="button" class="icon-btn compact ${state.filterPanelOpen ? "active" : ""}" title="${escapeAttribute(t("actions.advancedFilters"))}" aria-label="${escapeAttribute(t("actions.advancedFilters"))}" aria-expanded="${state.filterPanelOpen}" aria-controls="filter-panel" data-action="toggle-filter-panel">
        ${iconSpan("adjustments")}
        ${activeFilterCount ? `<b>${formatNumber(activeFilterCount)}</b>` : ""}
      </button>
      <button type="button" class="icon-btn compact" title="${escapeAttribute(t("actions.clearFilters"))}" aria-label="${escapeAttribute(t("actions.clearFilters"))}" data-action="clear-filters">
        ${iconSpan("x")}
      </button>
    </section>
    ${state.filterPanelOpen ? filterPanel(view, resultFilters) : ""}
  `;
}

function filterPanel(view, resultFilters) {
  const currentQuery = state.query.trim() || t("filters.noInput");
  const currentMode = state.filters.mode ? modeLabel(state.filters.mode) : t("filters.allModes");
  const currentSource = state.filters.source || t("filters.allSources");
  const currentResult = state.filters.result ? resultLabel(state.filters.result) : t("filters.allResults");

  return `
    <section class="filter-panel" id="filter-panel" aria-label="${escapeAttribute(t("aria.advancedFilterPanel"))}">
      <div class="filter-panel-inner">
        <div class="filter-panel-head">
          <div>
            <span>${escapeHtml(t("filters.title"))}</span>
            <strong>${escapeHtml(currentResult)} / ${escapeHtml(currentMode)} / ${escapeHtml(currentSource)}</strong>
          </div>
          <small>${escapeHtml(t("filters.search"))}: ${escapeHtml(currentQuery)}</small>
        </div>
        <div class="filter-panel-grid">
          <div class="filter-panel-group">
            <span>${escapeHtml(t("filters.result"))}</span>
            <div class="result-filter expanded" aria-label="${escapeAttribute(t("aria.advancedResultFilter"))}">
              ${resultFilters.map(([value, label]) => `
                <button type="button" class="${state.filters.result === value ? "active" : ""} ${value || "all"}" data-result-filter="${escapeAttribute(value)}">
                  ${escapeHtml(label)}
                </button>
              `).join("")}
            </div>
          </div>
          <div class="filter-panel-group">
            <span>${escapeHtml(t("filters.mode"))}</span>
            ${filterSelect("mode", ["", ...view.modeIds], state.filters.mode, t("filters.allModes"))}
          </div>
          <div class="filter-panel-group">
            <span>${escapeHtml(t("filters.source"))}</span>
            ${filterSelect("source", ["", ...view.sources], state.filters.source, t("filters.allSources"))}
          </div>
          <div class="filter-panel-actions">
            <button type="button" class="secondary-action" data-action="clear-filters">
              ${iconSpan("x")}
              <span>${escapeHtml(t("actions.clearFilters"))}</span>
            </button>
            <button type="button" class="primary-action" data-action="toggle-filter-panel">
              <span>${escapeHtml(t("actions.collapsePanel"))}</span>
            </button>
          </div>
        </div>
      </div>
    </section>
  `;
}

function activeView(view) {
  if (state.activeRoundDetail?.round) return roundDetailPage(view);
  return {
    overview: overviewView(view),
    matches: matchesView(view),
    modes: modesView(view),
    identity: identityView(view),
    share: shareView(view),
    audit: auditView(view),
  }[state.activeTab] ?? overviewView(view);
}

function overviewView(view) {
  return `
    <section class="overview-workbench view-pane" id="overview">
      <aside class="overview-profile-stack">
        ${playerDossierCard(view)}
        ${identityMiniCard(view)}
      </aside>

      <section class="overview-core">
        ${overviewSummaryCard(view)}
        <div class="hero-metrics">
          ${winLossCard(view)}
          ${statCard(t("overview.playtime"), view.overview.playtime, t("overview.allLocalSessions"), "TIME")}
          ${statCard(t("overview.reliableRounds"), formatNumber(view.reliableRecordCount), t("overview.highConfidenceRecord"), "ROUND")}
          ${statCard(t("overview.selfKd"), formatRatio(view.overview.selfKills, view.overview.selfDeaths), t("overview.killsDeaths"), "K/D", positiveTone(view.overview.selfKills))}
          ${statCard(t("overview.peakStreak"), formatNumber(view.streaks.selectedWin?.best?.count ?? 0), t("overview.bestDetectedStreak"), "STREAK", positiveTone(view.streaks.selectedWin?.best?.count ?? 0), winStreakPolicyToggle(view))}
          ${statCard(t("overview.currentWinStreak"), formatNumber(view.streaks.selectedWin?.current?.count ?? 0), t("overview.currentWinStreakSub"), "STREAK", positiveTone(view.streaks.selectedWin?.current?.count ?? 0))}
          ${statCard(t("overview.playerKillStreak"), formatNumber(view.streaks.playerMaxKillStreak), t("overview.playerKillStreakSub"), "K/D", positiveTone(view.streaks.playerMaxKillStreak))}
        </div>
        ${matchTapeCard(view)}
        ${activityCard(view)}
      </section>

      <aside class="overview-insights">
        ${modeBreakdownCard(view)}
        ${serverCoverageCard(view)}
        ${sourceCard(view)}
        ${auditMiniCard(view)}
      </aside>
    </section>
  `;
}

function overviewSummaryCard(view) {
  return `
    <article class="workbench-card overview-summary-card">
      <div>
        <span>${escapeHtml(t("overview.dossier"))}</span>
        <h1>${escapeHtml(view.playerName)}</h1>
        <p>${escapeHtml(t("overview.summary", { files: formatNumber(view.overview.files), recordSummary: view.reliableRecordSummary, winRate: percent(view.overview.winRate) }))}</p>
      </div>
      <div class="summary-rail">
        ${miniMetric(t("overview.chatLines"), formatNumber(view.overview.chatLines))}
        ${miniMetric(t("overview.logSources"), formatNumber(view.sources.length || 1))}
        ${miniMetric(t("overview.generatedAt"), formatDate(view.summary.generatedAt))}
      </div>
    </article>
  `;
}

function playerDossierCard(view) {
  const client = view.profile.preferences?.clientVersionByPlaytime;
  const visibleNames = profileAliasOptions(view).slice(0, 4);

  return `
    <article class="workbench-card player-card">
      <div class="player-headline">
        <div class="avatar-shell">
          ${pixelAvatar(view)}
          <button type="button" class="avatar-edit-trigger" data-action="open-profile-editor" title="${escapeAttribute(t("avatar.edit"))}" aria-label="${escapeAttribute(t("avatar.edit"))}">
            ${iconSpan("userSquare")}
            <span class="sr-only">${escapeHtml(t("avatar.edit"))}</span>
          </button>
        </div>
        <div>
          <div class="player-name">
            <strong>${escapeHtml(view.playerName)}</strong>
            <i aria-label="${escapeAttribute(t("aria.verifiedLocalPlayer"))}"></i>
          </div>
          <div class="chip-row">
            ${chip(view.sourceLabel, "green")}
            ${chip(displayScope(client?.scope ?? view.sourceLabel))}
          </div>
        </div>
      </div>

      <div class="hairline"></div>

      <div class="meta-list">
        ${metaRow(t("overview.firstSeen"), view.totals.firstPlayedDay)}
        ${metaRow(t("overview.lastSeen"), view.totals.lastPlayedDay)}
        ${metaRow(t("overview.logFiles"), formatNumber(view.overview.files))}
        ${metaRow(t("overview.chatLines"), formatNumber(view.overview.chatLines))}
        ${metaRow(t("overview.client"), displayScope(client?.scope ?? t("common.mixed")))}
        ${metaRow(t("overview.generatedAt"), formatDate(view.summary.generatedAt))}
      </div>

      <div class="hairline"></div>

      <div class="alias-list">
        <div class="card-kicker">${escapeHtml(t("overview.identity"))} / ${formatNumber(view.serverIdentityCount)}</div>
        ${visibleNames.map((name, index) => `
          <div class="alias-row ${name === view.playerName ? "primary" : ""}">
            <span><i></i>${escapeHtml(name)}</span>
            <b>${escapeHtml(name === view.playerName ? t("overview.confirmed") : t("overview.linked"))}</b>
          </div>
        `).join("") || emptyState(t("overview.noAliases"))}
      </div>
    </article>
  `;
}

function winLossCard(view) {
  const wins = Number(view.overview.wins ?? 0);
  const losses = Number(view.overview.losses ?? 0);
  const unknown = Number(view.overview.unknownResults ?? 0);
  const total = Math.max(wins + losses + unknown, 1);
  const winPct = (wins / total) * 100;
  const lossPct = (losses / total) * 100;
  const unknownPct = Math.max(0, 100 - winPct - lossPct);

  return `
    <article class="workbench-card win-loss-card">
      <div class="card-topline">
        <span>${escapeHtml(t("overview.winLoss"))}</span>
        ${chip(t("overview.identified", { rate: percent(view.overview.knownResultRate) }), positiveTone(view.overview.knownResultRate))}
      </div>
      <div class="winrate-value ${escapeAttribute(positiveTone(view.overview.winRate))}">${escapeHtml(percent(view.overview.winRate))}</div>
      <div class="split-bar" aria-label="${escapeAttribute(t("aria.winLossSplit"))}">
        <span class="win" style="width:${winPct}%"></span>
        <span class="loss" style="width:${lossPct}%"></span>
        <span class="unknown" style="width:${unknownPct}%"></span>
      </div>
      <div class="split-counts">
        <span><b>${formatNumber(wins)}</b> ${escapeHtml(t("common.wins"))}</span>
        <span><b>${formatNumber(losses)}</b> ${escapeHtml(t("common.losses"))}</span>
        <span><b>${formatNumber(unknown)}</b> ${escapeHtml(t("common.unknown"))}</span>
      </div>
    </article>
  `;
}

function statCard(label, value, sub, marker, tone = "", extra = "") {
  const resolvedTone = metricTone(value, tone);
  return `
    <article class="workbench-card stat-card ${escapeAttribute(resolvedTone)}">
      <div class="card-topline">
        <span>${escapeHtml(label)}</span>
        <span class="metric-glyph" aria-hidden="true">${metricIcon(marker)}</span>
      </div>
      <strong>${escapeHtml(value ?? "0")}</strong>
      <small>${escapeHtml(sub ?? "")}</small>
      ${extra}
    </article>
  `;
}

function winStreakPolicyToggle(view) {
  const selected = view.streaks.selectedWinPolicy === "skipUnknown" ? "skipUnknown" : "breakUnknown";
  const options = [
    ["breakUnknown", t("overview.winStreakBreakUnknown")],
    ["skipUnknown", t("overview.winStreakSkipUnknown")],
  ];
  return `
    <div class="mini-toggle" aria-label="${escapeAttribute(t("overview.peakStreak"))}">
      ${options.map(([value, label]) => `
        <button type="button" class="${selected === value ? "active" : ""}" data-action="set-win-streak-policy" data-win-streak-policy="${escapeAttribute(value)}" aria-pressed="${selected === value}">
          ${escapeHtml(label)}
        </button>
      `).join("")}
    </div>
  `;
}

function metricIcon(marker) {
  return tablerIcon(marker, "metric-icon");
}

function arrowIcon(direction) {
  return tablerIcon(direction === "right" ? "chevronRight" : "chevronLeft", "heat-arrow-icon");
}

function tablerIcon(name, className = "") {
  const icon = TABLER_ICON_PATHS[name] ?? TABLER_ICON_PATHS.search;
  return `
    <svg class="tabler-icon ${escapeAttribute(className)}" data-icon="${escapeAttribute(icon.name)}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
      ${icon.body}
    </svg>
  `;
}

function iconSpan(name, className = "icon") {
  return `<span class="${escapeAttribute(className)}" aria-hidden="true">${tablerIcon(name)}</span>`;
}

function matchTapeCard(view) {
  const rounds = view.recentRounds.slice(0, 48);
  const wins = rounds.filter((round) => round.result === "win").length;
  const losses = rounds.filter((round) => round.result === "loss").length;
  const unknown = rounds.length - wins - losses;

  return `
    <article class="workbench-card match-tape-card">
      <div class="card-topline">
        <span>${escapeHtml(t("overview.recentMatches"))} / ${formatNumber(rounds.length)}</span>
        <div class="mini-legend">
          <span><i class="win"></i>${formatNumber(wins)} ${escapeHtml(t("common.wins"))}</span>
          <span><i class="loss"></i>${formatNumber(losses)} ${escapeHtml(t("common.losses"))}</span>
          <span><i class="unknown"></i>${formatNumber(unknown)} ${escapeHtml(t("common.unknown"))}</span>
        </div>
      </div>
      <div class="match-tape">
        ${rounds.map((round, index) => tapeCell(round, index, rounds.length)).join("") || emptyState(t("overview.noRecentMatches"))}
      </div>
      <div class="tape-sparkline" aria-hidden="true">
        <span>${escapeHtml(t("common.earlier"))}</span>
        <div>${rounds.slice().reverse().map((round) => `<i class="${resultTone(round.result)}"></i>`).join("")}</div>
        <span>${escapeHtml(t("common.latest"))}</span>
      </div>
    </article>
  `;
}

function tapeCell(round, index, total) {
  const title = `${formatDateTime(round.startAt)} / ${modeLabel(round.gameMode)} / ${resultLabel(round.result)} / ${round.duration ?? "0s"}`;
  const key = tapeRoundKey(round, index);
  const active = key === state.activeTapeRoundKey;
  return `
    <button type="button" class="${resultTone(round.result)} ${active ? "active" : ""}" data-action="select-tape-round" data-tape-round="${escapeAttribute(key)}" aria-label="${escapeAttribute(title)}">
      <span>${escapeHtml(resultInitial(round.result))}</span>
      <b>${formatNumber(total - index)}</b>
    </button>
  `;
}

function tapeRoundKey(round, index) {
  const rawKey = String(round?.key ?? `${round?.startAt ?? "round"}-${round?.gameMode ?? "unknown"}-${index}`);
  return `${index}-${hashTapeRoundKey(rawKey)}`;
}

function hashTapeRoundKey(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function tapeDetail(round) {
  const result = safeResult(round.result);
  const selfKills = playerSelfKills(round);
  const selfDeaths = playerSelfDeaths(round);
  const source = displayScope(round.serverLabel ?? t("common.local"));
  return `
    <div class="tape-detail ${escapeAttribute(resultTone(result))}" aria-live="polite">
      <div class="tape-detail-head">
        <div>
          <span>${escapeHtml(formatDateTime(round.startAt))}</span>
          <strong>${escapeHtml(modeLabel(round.gameMode))}</strong>
        </div>
        <span class="result-badge ${resultTone(result)}">${escapeHtml(resultLabel(result))}</span>
      </div>
      <div class="tape-detail-grid">
        ${miniMetric(t("matches.duration"), round.duration ?? "0s")}
        ${miniMetric("K/D", formatRatio(selfKills, selfDeaths), positiveTone(selfKills))}
        ${miniMetric(t("matches.selfKills"), formatNumber(selfKills), positiveTone(selfKills))}
        ${miniMetric(t("matches.deaths"), formatNumber(selfDeaths), deathTone(selfDeaths))}
      </div>
      <div class="tape-detail-source">
        <span>${escapeHtml(t("matches.source"))}</span>
        <strong>${escapeHtml(source)}</strong>
      </div>
    </div>
  `;
}

function setActiveTapeRound(key) {
  state.activeTapeRoundKey = key;
  const card = root.querySelector(".match-tape-card");
  if (!card) return;

  card.querySelectorAll("[data-tape-round]").forEach((button) => {
    button.classList.toggle("active", button.dataset.tapeRound === key);
  });
}

function showTapeTooltip(key, event) {
  const view = buildViewModel();
  const rounds = view.recentRounds.slice(0, 48);
  const round = rounds.find((item, index) => tapeRoundKey(item, index) === key);
  if (!round) return;

  setActiveTapeRound(key);
  showFloatingTooltip(`tape:${key}`, tapeDetail(round), event);
}

function openTapeRoundDetail(key) {
  const view = buildViewModel();
  const rounds = view.recentRounds.slice(0, 48);
  const roundIndex = rounds.findIndex((item, index) => tapeRoundKey(item, index) === key);
  if (roundIndex < 0) return;
  const round = rounds[roundIndex];
  openRoundDetail(round, roundDetailKey(round, roundIndex), "overview");
}

function showHeatTooltip(target, event) {
  const date = target.dataset.heatDate ?? "";
  const playtime = target.dataset.heatPlaytime ?? "0s";
  const rounds = target.dataset.heatRounds ?? "0";
  const reliableRounds = target.dataset.heatReliableRounds ?? "0";
  const level = Number(target.dataset.heatLevel ?? 0);
  showFloatingTooltip(`heat:${date}`, heatTooltipDetail({ date, playtime, rounds, reliableRounds, level }), event);
}

function showFloatingTooltip(key, html, event) {
  const tooltip = ensureTapeTooltip();
  if (activeTapeTooltipKey !== key) {
    tooltip.innerHTML = html;
    activeTapeTooltipKey = key;
  }
  positionTapeTooltip(tooltip, event);
  tooltip.classList.add("visible");
  tooltip.setAttribute("aria-hidden", "false");
}

function positionTapeTooltip(tooltip, event) {
  const padding = 14;
  const offset = 16;
  const targetRect = event?.currentTarget?.getBoundingClientRect?.();
  const pointerX = event?.clientX ?? (targetRect ? targetRect.left + targetRect.width / 2 : window.innerWidth / 2);
  const pointerY = event?.clientY ?? (targetRect ? targetRect.top + targetRect.height / 2 : window.innerHeight / 2);
  const width = tooltip.offsetWidth || 320;
  const height = tooltip.offsetHeight || 150;
  let left = pointerX + offset;
  let top = pointerY + offset;

  if (left + width + padding > window.innerWidth) left = pointerX - width - offset;
  if (top + height + padding > window.innerHeight) top = pointerY - height - offset;
  left = clamp(left, padding, Math.max(padding, window.innerWidth - width - padding));
  top = clamp(top, padding, Math.max(padding, window.innerHeight - height - padding));

  tooltip.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
}

function heatTooltipDetail(day) {
  const intensity = day.level > 0 ? `${day.level}/4` : t("common.none");
  return `
    <div class="tape-detail heat-detail" aria-live="polite">
      <div class="tape-detail-head">
        <div>
          <span>${escapeHtml(t("overview.activityHeat"))}</span>
          <strong>${escapeHtml(day.date || t("common.unknown"))}</strong>
        </div>
        <span class="result-badge unknown">${escapeHtml(intensity)}</span>
      </div>
      <div class="tape-detail-grid">
        ${miniMetric(t("modes.duration"), day.playtime)}
        ${miniMetric(t("modes.rounds"), day.rounds, positiveTone(day.rounds))}
        ${miniMetric(t("overview.reliableRounds"), day.reliableRounds)}
      </div>
    </div>
  `;
}

function activityCard(view) {
  const calendar = view.calendarGraph;
  const days = calendar.weeks.flatMap((week) => week.days);
  const canGoNewer = calendar.windowIndex > 0;
  const canGoOlder = calendar.windowIndex < calendar.maxWindowIndex;
  const canGoEarliest = calendar.windowIndex < calendar.maxWindowIndex;
  const atEarliestWindow = calendar.maxWindowIndex > 0 && calendar.windowIndex >= calendar.maxWindowIndex;
  const atLatestWindow = calendar.windowIndex === 0;

  return `
    <article class="workbench-card activity-card">
      <div class="card-topline">
        <span>${escapeHtml(t("overview.activityHeat"))}</span>
        <div class="heat-tools">
          <div class="heat-legend">
            <small>${escapeHtml(t("common.less"))}</small>
            ${[0, 1, 2, 3, 4].map((level) => `<i class="level-${level}"></i>`).join("")}
            <small>${escapeHtml(t("common.more"))}</small>
          </div>
        </div>
      </div>
      <div class="activity-heatmap">
        <div class="heat-days">
          ${calendar.weekdayLabels.map((label, index) => `<span>${index % 2 === 0 ? escapeHtml(label[0]) : ""}</span>`).join("")}
        </div>
        <div class="heat-board">
          <div class="heat-months">
            ${calendar.monthLabels.map((month) => `<span style="grid-column:${month.column} / span ${month.span}">${escapeHtml(month.label)}</span>`).join("")}
          </div>
          <div class="heat-weeks">
            ${calendar.weeks.map((week) => `
              <div class="heat-week">
                ${week.days.map((day) => `
                  <i class="heat-cell level-${day.level} ${day.isEmpty ? "is-empty" : ""}" tabindex="0" role="img" aria-label="${escapeAttribute(`${day.date}: ${day.playtime}, ${t("overview.roundCount", { count: formatNumber(day.totalRounds) })}`)}" data-heat-day="${escapeAttribute(day.date)}" data-heat-date="${escapeAttribute(day.date)}" data-heat-playtime="${escapeAttribute(day.playtime)}" data-heat-rounds="${escapeAttribute(formatNumber(day.totalRounds))}" data-heat-reliable-rounds="${escapeAttribute(formatNumber(day.reliableRounds))}" data-heat-level="${day.level}"></i>
                `).join("")}
              </div>
            `).join("")}
          </div>
        </div>
      </div>
      <div class="heat-nav-row">
        <div class="heat-jump-group">
          <button type="button" class="${atEarliestWindow ? "active" : ""}" data-action="heatmap-earliest" aria-label="${escapeAttribute(uiCopy("earliestHeat"))}" aria-pressed="${atEarliestWindow}" ${canGoEarliest ? "" : "disabled"}>${escapeHtml(uiCopy("earliest"))}</button>
          <button type="button" class="${atLatestWindow ? "active" : ""}" data-action="heatmap-latest" aria-label="${escapeAttribute(uiCopy("latestHeat"))}" aria-pressed="${atLatestWindow}" ${canGoNewer ? "" : "disabled"}>${escapeHtml(t("common.latest"))}</button>
        </div>
        <div class="heat-pager" aria-label="${escapeAttribute(uiCopy("heatPager"))}">
          <button type="button" class="heat-arrow" data-action="heatmap-older" aria-label="${escapeAttribute(uiCopy("olderHeat"))}" ${canGoOlder ? "" : "disabled"}>${arrowIcon("left")}</button>
          <button type="button" class="heat-arrow" data-action="heatmap-newer" aria-label="${escapeAttribute(uiCopy("newerHeat"))}" ${canGoNewer ? "" : "disabled"}>${arrowIcon("right")}</button>
        </div>
        <span class="heat-range">${escapeHtml(calendar.rangeStart)} - ${escapeHtml(calendar.rangeEnd)}</span>
      </div>
      <div class="activity-foot">
        <span>${escapeHtml(t("overview.activeDays", { count: formatNumber(calendar.summary.activeDays) }))}</span>
        <span>${formatDurationFromSeconds(calendar.summary.playtimeSeconds)}</span>
        <span>${escapeHtml(t("overview.roundCount", { count: formatNumber(calendar.summary.totalRounds) }))}</span>
        <span>${escapeHtml(t("overview.reliableRounds"))}: ${formatNumber(calendar.summary.reliableRounds)}</span>
      </div>
      <span class="sr-only">${escapeHtml(t("overview.calendarCells", { count: formatNumber(days.length) }))}</span>
    </article>
  `;
}

function modeBreakdownCard(view) {
  const sort = normalizeOverviewModeSort(state.overviewModeSort);
  return `
    <article class="workbench-card mode-card" id="modes">
      <div class="card-topline">
        <span>${escapeHtml(t("overview.modeBreakdown"))}</span>
        <div class="card-topline-actions">
          ${overviewSortToggle("mode", sort, [
            ["rounds", t("overview.sortByRounds")],
            ["duration", t("overview.sortByDuration")],
            ["kills", t("overview.sortByKills")],
          ], t("overview.sortModeBreakdown"))}
          ${chip(view.reliableRecordSummary)}
        </div>
      </div>
      <div class="mode-list">
        ${view.overviewTopModes.slice(0, 5).map((mode) => modeRow(mode, view.maxOverviewModeScore, sort)).join("") || emptyState(t("overview.noModeData"))}
      </div>
    </article>
  `;
}

function modeRow(mode, maxScore, metric = "rounds") {
  const rounds = Number(mode.rounds ?? 0);
  const selfKills = modeSelfKills(mode);
  const normalizedMetric = normalizeOverviewModeSort(metric);
  const score = overviewModeScore(mode, normalizedMetric);
  const ratio = maxScore ? clamp(score / maxScore, 0, 1) : 0;
  const value = normalizedMetric === "duration" ? formatDurationFromSeconds(score) : formatNumber(score);
  const duration = mode.duration ?? formatDurationFromSeconds(modeDurationSeconds(mode));
  const subtitle = normalizedMetric === "duration"
    ? modeKillsSummary(mode, rounds, selfKills)
    : `${modeKillsSummary(mode, rounds, selfKills)} / ${duration}`;
  return `
    <div class="mode-row">
      <div>
        <strong>${escapeHtml(mode.label ?? mode.id ?? t("common.unknown"))}</strong>
        <span>${escapeHtml(subtitle)}</span>
      </div>
      <div class="mini-progress"><i style="width:${Math.round(ratio * 100)}%"></i></div>
      <b>${escapeHtml(value)}</b>
    </div>
  `;
}

function sortOverviewModes(modes = [], sort = "rounds") {
  const metric = normalizeOverviewModeSort(sort);
  return [...modes].sort((a, b) =>
    overviewModeScore(b, metric) - overviewModeScore(a, metric)
    || String(a.label ?? a.id ?? "").localeCompare(String(b.label ?? b.id ?? ""), localeCode()),
  );
}

function overviewModeScore(mode, metric = "rounds") {
  if (metric === "duration") return modeDurationSeconds(mode);
  if (metric === "kills") return modeSelfKills(mode);
  return finiteNumber(mode.rounds);
}

function modeDurationSeconds(mode = {}) {
  return finiteNumber(mode.durationSeconds, mode.playtimeSeconds, mode.seconds);
}

function playerSelfKills(row = {}) {
  return Number(row.selfKills ?? 0);
}

function playerSelfDeaths(row = {}) {
  return Number(row.selfDeaths ?? 0);
}

function playerBedDestroys(row = {}) {
  return Number(row.playerBedDestroys ?? row.selfBedDestroys ?? 0);
}

function modeSelfKills(mode = {}) {
  return Number(mode.selfKills ?? 0);
}

function modeSelfDeaths(mode = {}) {
  return Number(mode.selfDeaths ?? 0);
}

function modeObservedKills(mode = {}) {
  return Number(mode.observedKills ?? mode.kills ?? 0);
}

function normalizeOverviewModeSort(value) {
  if (value === "duration" || value === "kills") return value;
  return "rounds";
}

function overviewSortToggle(kind, selected, options, label) {
  return `
    <div class="card-sort-toggle" aria-label="${escapeAttribute(label)}">
      ${options.map(([value, optionLabel]) => `
        <button type="button" class="${selected === value ? "active" : ""}" data-action="set-overview-sort" data-overview-sort-kind="${escapeAttribute(kind)}" data-overview-sort="${escapeAttribute(value)}" aria-pressed="${selected === value}">
          ${escapeHtml(optionLabel)}
        </button>
      `).join("")}
    </div>
  `;
}

function identityMiniCard(view) {
  return `
    <article class="workbench-card identity-card" id="identity">
      <div class="card-topline">
        <span>${escapeHtml(t("overview.serverIdentities"))}</span>
        ${chip(t("overview.serverIdentityCount", { count: formatNumber(view.serverIdentityCount) }))}
      </div>
      <div class="identity-list">
        ${view.serverIdentityRows.slice(0, 5).map((identity, index) => identityRow(identity, index)).join("") || emptyState(t("overview.noServerIdentities"))}
      </div>
    </article>
  `;
}

function serverCoverageCard(view) {
  const serverScores = view.overviewServerRows.map(serverScore);
  const fallbackScore = Number(view.reliableRecordCount ?? 0);
  const maxServerScore = serverScores.length ? Math.max(...serverScores, 1) : Math.max(fallbackScore, 1);
  const sort = state.overviewServerSort === "name" ? "name" : "duration";

  return `
    <article class="workbench-card source-card server-card">
      <div class="card-topline">
        <span>${escapeHtml(serverCopy("coverage"))}</span>
        <div class="card-topline-actions">
          ${overviewSortToggle("server", sort, [
            ["duration", serverCopy("sortByActivity")],
            ["name", serverCopy("sortByName")],
          ], serverCopy("sort"))}
          ${chip(serverCopy("count", { count: formatNumber(view.serverCount) }))}
        </div>
      </div>
      <div class="source-list server-list">
        ${view.overviewServerRows.map((row) => serverRow(row, maxServerScore)).join("") || emptyState(serverCopy("noData"))}
      </div>
    </article>
  `;
}

function serverRow(row, maxServerScore) {
  const score = serverScore(row);
  const ratio = maxServerScore ? clamp(score / maxServerScore, 0, 1) : 0;
  const mainMode = row.modes?.[0]?.[0] ? modeLabel(row.modes[0][0]) : t("common.mixed");
  const counts = [
    row.rounds ? serverCopy("rounds", { rounds: formatNumber(row.rounds) }) : "",
    row.activities ? serverCopy("activities", { activities: formatNumber(row.activities) }) : "",
  ].filter(Boolean).join(" / ");
  return `
    <div class="source-row server-row">
      <div>
        <strong>${escapeHtml(row.label)}</strong>
        <span>${escapeHtml([mainMode, counts].filter(Boolean).join(" / "))}</span>
      </div>
      <div class="mini-progress"><i style="width:${Math.round(ratio * 100)}%"></i></div>
      <b>${escapeHtml(serverDisplayValue(row))}</b>
    </div>
  `;
}

function serverScore(row = {}) {
  return finiteNumber(row.durationSeconds, row.records);
}

function serverDisplayValue(row = {}) {
  if (row.durationSeconds > 0) return row.duration;
  return serverCopy("records", { records: formatNumber(row.records ?? 0) });
}

function identityRow(account, index) {
  const name = account.name ?? account.serverPlayerId ?? account.user ?? "unknown";
  const value = account.rounds
    ? t("overview.roundCount", { count: formatNumber(account.rounds) })
    : account.evidence
      ? t("overview.signals", { count: formatNumber(account.evidence) })
      : account.playtime ?? account.duration ?? account.totalPlaytime ?? "0s";
  return `
    <div class="identity-row ${index === 0 ? "primary" : ""}">
      <span><i></i>${escapeHtml(name)}</span>
      <b>${escapeHtml(value)}</b>
    </div>
  `;
}

function sourceCard(view) {
  const sourceScores = view.overviewClientRows.map(sourceScore);
  const fallbackScore = Number(view.overview.files ?? 0);
  const maxSourceScore = sourceScores.length ? Math.max(...sourceScores, 1) : Math.max(fallbackScore, 1);
  const sort = state.overviewSourceSort === "client" ? "client" : "duration";

  return `
    <article class="workbench-card source-card">
      <div class="card-topline">
        <span>${escapeHtml(t("overview.sourceCoverage"))}</span>
        <div class="card-topline-actions">
          ${overviewSortToggle("source", sort, [
            ["duration", t("overview.sortByDuration")],
            ["client", t("overview.sortByClient")],
          ], t("overview.sortSourceCoverage"))}
          ${chip(t("overview.sourceCount", { count: formatNumber(view.sources.length || 1) }))}
        </div>
      </div>
      <div class="source-list">
        ${view.overviewClientRows.map((row) => sourceRow(row, maxSourceScore)).join("") || sourceRow({ source: view.sourceLabel, files: view.overview.files, scope: view.sourceLabel }, maxSourceScore)}
      </div>
    </article>
  `;
}

function sourceRow(row, maxSourceScore) {
  const score = sourceScore(row);
  const displayValue = sourceDisplayValue(row, score);
  const ratio = maxSourceScore ? clamp(score / maxSourceScore, 0, 1) : 0;
  return `
    <div class="source-row">
      <div>
        <strong>${escapeHtml(sourceClientLabel(row))}</strong>
        <span>${escapeHtml(sourceFolderLabel(row))}</span>
      </div>
      <div class="mini-progress"><i style="width:${Math.round(ratio * 100)}%"></i></div>
      <b>${escapeHtml(displayValue)}</b>
    </div>
  `;
}

function sourceScore(row) {
  return finiteNumber(
    row.playtimeSeconds,
    row.durationSeconds,
    row.runtimeSeconds,
    row.rounds?.durationSeconds,
    parseDurationText(row.playtime),
    parseDurationText(row.duration),
    parseDurationText(row.runtime),
    row.files,
    row.count,
    row.reliableRounds,
    row.sessions,
  );
}

function sortOverviewSources(rows = [], sort = "duration") {
  const normalizedSort = sort === "client" ? "client" : "duration";
  return [...rows].sort((a, b) => {
    if (normalizedSort === "client") {
      return sourceClientLabel(a).localeCompare(sourceClientLabel(b), localeCode(), { numeric: true, sensitivity: "base" })
        || sourceScore(b) - sourceScore(a)
        || sourceFolderLabel(a).localeCompare(sourceFolderLabel(b), localeCode(), { numeric: true, sensitivity: "base" });
    }
    return sourceScore(b) - sourceScore(a)
      || sourceClientLabel(a).localeCompare(sourceClientLabel(b), localeCode(), { numeric: true, sensitivity: "base" });
  });
}

function sourceClientLabel(row = {}) {
  const value = row.scope ?? row.client ?? row.clientLabel ?? row.name;
  if (isRootScope(value)) return sourceFolderName(row);
  if (!value && isRootScope(row.source)) return t("common.localLogs");
  return displayScope(value);
}

function sourceFolderLabel(row = {}) {
  const value = row.scope ?? row.client ?? row.clientLabel ?? row.name;
  if (isRootScope(value)) return t("overview.clientRoot");
  return sourceFolderName(row);
}

function sourceFolderName(row = {}) {
  return row.source ?? row.rootName ?? row.root ?? row.folder ?? t("common.localLogs");
}

function isRootScope(value) {
  const text = String(value ?? "").trim();
  return !text || text === "(root)";
}

function sourceDisplayValue(row = {}, score = sourceScore(row)) {
  if (row.playtime) return row.playtime;
  if (row.duration) return row.duration;
  if (score > 0 && finiteNumber(row.playtimeSeconds, row.durationSeconds, row.runtimeSeconds, row.rounds?.durationSeconds)) {
    return formatDurationFromSeconds(score);
  }
  return formatNumber(score);
}

function auditMiniCard(view) {
  const total = view.diagnostics.reliable + view.diagnostics.unknown + view.diagnostics.ignored;
  return `
    <article class="workbench-card audit-card" id="audit">
      <div class="card-topline">
        <span>${escapeHtml(t("overview.auditOverview"))}</span>
        ${chip(t("overview.signals", { count: formatNumber(total) }))}
      </div>
      <div class="audit-strip">
        ${auditSegment("reliable", view.diagnostics.reliable, total)}
        ${auditSegment("unknown", view.diagnostics.unknown, total)}
        ${auditSegment("ignored", view.diagnostics.ignored, total)}
      </div>
      <div class="audit-grid">
        ${miniMetric(t("overview.reliable"), formatNumber(view.diagnostics.reliable), positiveTone(view.diagnostics.reliable))}
        ${miniMetric(t("common.unknown"), formatNumber(view.diagnostics.unknown), "warn")}
        ${miniMetric(t("overview.ignored"), formatNumber(view.diagnostics.ignored), "ignored")}
      </div>
    </article>
  `;
}

function auditSegment(name, value, total) {
  const width = total ? Math.max(4, Math.round((Number(value) / total) * 100)) : 0;
  return `<span class="${escapeAttribute(name)}" style="width:${width}%"></span>`;
}

function miniMetric(label, value, tone = "") {
  const valueClass = metricValueClass(label);
  const resolvedTone = metricTone(value, tone);
  return `
    <div class="mini-metric ${escapeAttribute(resolvedTone)}">
      <span>${escapeHtml(label)}</span>
      <strong class="${escapeAttribute(valueClass)}">${metricValueHtml(label, value)}</strong>
    </div>
  `;
}

function matchesView(view) {
  const sourceRounds = matchesSourceRows();
  const searchedRounds = sortMatchesByTime(filterRoundsByQuery(sourceRounds, state.query));
  const queryActive = Boolean(state.query.trim());
  const sortedSourceRounds = sortMatchesByTime(sourceRounds);
  const total = queryActive ? searchedRounds.length : sortedSourceRounds.length;
  const pageCount = pageCountFor(total, state.matchesPageSize);
  const page = clampPage(state.matchesPage, pageCount);
  if (state.matchesPage !== page) state.matchesPage = page;
  const rounds = queryActive
    ? pageItems(searchedRounds, page, state.matchesPageSize)
    : pageItems(sortedSourceRounds, page, state.matchesPageSize);
  const querySuffix = queryActive ? t("matches.querySuffix", { count: formatNumber(searchedRounds.length) }) : "";
  const orderLabel = state.matchesSort === "oldest" ? t("matches.oldestOrder") : t("matches.newestOrder");
  return `
    <section class="view-pane matches-view" id="matches">
      <div class="section-head">
        <div>
          <span>${escapeHtml(t("matches.eyebrow"))}</span>
          <h1>${escapeHtml(t("matches.title"))}</h1>
        </div>
        <p>${escapeHtml(t("matches.summary", { total: formatNumber(total), shown: formatNumber(rounds.length), suffix: querySuffix, order: orderLabel }))}</p>
      </div>
      ${viewToolbar("matches", state.matchesViewMode, total, page, pageCount)}
      ${state.matchesViewMode === "list" ? matchList(rounds, page) : `<div class="match-card-grid">${rounds.map((round, index) => matchCard(round, index + page * state.matchesPageSize)).join("") || emptyState(t("matches.noMatches"))}</div>`}
      ${paginationControls("matches", page, pageCount, total)}
    </section>
  `;
}

function matchCard(round, index) {
  const tone = resultTone(round.result);
  const detailKey = roundDetailKey(round, index);
  const selfKills = playerSelfKills(round);
  const selfDeaths = playerSelfDeaths(round);
  const kd = formatRatio(selfKills, selfDeaths);
  const server = roundServerLabel(round);
  return `
    <article class="workbench-card match-card">
      <div class="match-card-head">
        <span class="result-badge ${tone}">${escapeHtml(resultLabel(round.result))}</span>
        <small>#${formatNumber(index + 1)}</small>
      </div>
      <strong>${escapeHtml(modeLabel(round.gameMode))}</strong>
      <p>${escapeHtml(formatDateTime(round.startAt))}</p>
      <div class="match-card-facts">
        ${roundFact(matchCopy("result"), resultLabel(round.result), tone)}
        ${roundFact(matchCopy("server"), server)}
        ${roundFact(t("matches.duration"), round.duration ?? "0s")}
        ${roundFact("K/D", kd, positiveTone(selfKills))}
        ${roundFact(t("matches.selfKills"), formatNumber(selfKills), positiveTone(selfKills))}
        ${roundFact(t("matches.deaths"), formatNumber(selfDeaths), deathTone(selfDeaths))}
        ${roundFact(matchCopy("beds"), formatNumber(playerBedDestroys(round)), positiveTone(playerBedDestroys(round)))}
        ${roundFact(matchCopy("confidence"), round.confidence ?? round.parserConfidence ?? missingValue())}
      </div>
      <button type="button" class="detail-toggle" data-action="open-round-detail" data-round-key="${escapeAttribute(detailKey)}">
        ${escapeHtml(uiCopy("viewDetail"))}
      </button>
    </article>
  `;
}

function matchesSourceRows() {
  return state.roundSearchCache?.items ?? state.rounds?.items ?? [];
}

function findRoundByDetailKey(key) {
  const sourceRounds = matchesSourceRows();
  const sortedSourceRounds = sortMatchesByTime(sourceRounds);
  const searchedRounds = sortMatchesByTime(filterRoundsByQuery(sourceRounds, state.query));
  const queryActive = Boolean(state.query.trim());
  const rounds = queryActive
    ? pageItems(searchedRounds, state.matchesPage, state.matchesPageSize)
    : pageItems(sortedSourceRounds, state.matchesPage, state.matchesPageSize);
  return rounds.find((round, index) => roundDetailKey(round, index + state.matchesPage * state.matchesPageSize) === key)
    ?? sortedSourceRounds.find((round, index) => roundDetailKey(round, index) === key)
    ?? state.recentRounds?.items?.find((round, index) => roundDetailKey(round, index) === key)
    ?? null;
}

function matchList(rounds, page) {
  return `
    <div class="data-list match-list">
      ${rounds.map((round, index) => matchListRow(round, index + page * state.matchesPageSize)).join("") || emptyState(t("matches.noMatches"))}
    </div>
  `;
}

function matchListRow(round, index) {
  const detailKey = roundDetailKey(round, index);
  return `
    <article class="data-row match-row">
      <button type="button" data-action="open-round-detail" data-round-key="${escapeAttribute(detailKey)}">
        <span class="result-badge ${resultTone(round.result)}">${escapeHtml(resultLabel(round.result))}</span>
        <strong>#${formatNumber(index + 1)} ${escapeHtml(modeLabel(round.gameMode))}</strong>
        <span>${escapeHtml(formatDateTime(round.startAt))}</span>
        <span>${escapeHtml(round.duration ?? "0s")}</span>
        <b>${escapeHtml(roundServerLabel(round))}</b>
      </button>
    </article>
  `;
}

function roundDetailKey(round, index = 0) {
  const rawKey = String(round?.key ?? `${round?.startAt ?? "round"}-${round?.gameMode ?? "unknown"}-${index}`);
  return `round-${hashTapeRoundKey(rawKey)}`;
}

function roundDetailPage(view) {
  const round = state.activeRoundDetail?.round;
  const detailKey = state.activeRoundDetail?.key ?? roundDetailKey(round);
  if (!round) {
    state.activeRoundDetail = null;
    return state.roundDetailReturnTab === "overview" ? overviewView(view) : matchesView(view);
  }
  const returnTab = normalizeRoundDetailReturnTab(state.roundDetailReturnTab);
  return `
    <section class="view-pane round-detail-page" id="match-detail">
      <div class="round-detail-nav">
        <button type="button" class="secondary-action" data-action="close-round-detail">
          ${escapeHtml(returnTab === "overview" ? matchCopy("backToOverview") : matchCopy("backToMatches"))}
        </button>
        <span>${escapeHtml(matchCopy("detailContext"))}</span>
      </div>
      ${roundDetailHero(round)}
      ${roundDetailSummary(round)}
      ${roundDetailBody(round, detailKey)}
    </section>
  `;
}

function roundDetailHero(round) {
  const tone = resultTone(round.result);
  return `
    <article class="round-detail-hero ${tone}">
      <div>
        <span class="result-badge ${tone}">${escapeHtml(resultLabel(round.result))}</span>
        <h1>${escapeHtml(modeLabel(round.gameMode))}</h1>
        <p>${escapeHtml(roundServerLabel(round))}</p>
      </div>
      <div class="round-detail-hero-meta">
        ${roundFact(matchCopy("startAt"), formatDateTime(round.startAt))}
        ${roundFact(t("matches.duration"), round.duration ?? "0s")}
        ${roundFact(matchCopy("resultReason"), round.resultReason ?? missingValue())}
      </div>
    </article>
  `;
}

function roundDetailSummary(round) {
  const selfKills = playerSelfKills(round);
  const selfDeaths = playerSelfDeaths(round);
  const beds = playerBedDestroys(round);
  const kd = formatRatio(selfKills, selfDeaths);
  return `
    <div class="round-detail-summary">
      ${roundFact("K/D", kd, positiveTone(selfKills))}
      ${roundFact(t("matches.selfKills"), formatNumber(selfKills), positiveTone(selfKills))}
      ${roundFact(t("matches.deaths"), formatNumber(selfDeaths), deathTone(selfDeaths))}
      ${roundFact(matchCopy("beds"), formatNumber(beds), positiveTone(beds))}
      ${roundFact(matchCopy("playerMaxKillStreak"), formatNumber(round.playerMaxKillStreak ?? 0), positiveTone(round.playerMaxKillStreak ?? 0))}
      ${roundFact(matchCopy("server"), roundServerLabel(round))}
      ${roundFact(matchCopy("confidence"), round.confidence ?? round.parserConfidence ?? missingValue())}
    </div>
  `;
}

function openRoundDetail(round, key, returnTab = "matches") {
  if (!round) return;
  const normalizedReturnTab = normalizeRoundDetailReturnTab(returnTab);
  state.activeTab = normalizedReturnTab;
  state.roundDetailReturnTab = normalizedReturnTab;
  state.activeRoundDetail = { key, round };
  state.expandedRoundKey = "";
  state.roundDebugOpenKey = "";
  state.activeTapeRoundKey = "";
  hideTapeTooltip();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function closeRoundDetail() {
  state.activeTab = normalizeRoundDetailReturnTab(state.roundDetailReturnTab);
  state.activeRoundDetail = null;
  state.roundDebugOpenKey = "";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function normalizeRoundDetailReturnTab(value) {
  return value === "overview" ? "overview" : "matches";
}

function roundDetailBody(round, detailKey) {
  const timeline = roundEvidenceTimeline(round);
  const participantBlocks = [
    participantRank(matchCopy("killers"), round.killers),
    participantRank(matchCopy("victims"), round.victims),
    participantRank(matchCopy("bedDestroyers"), round.bedDestroyers),
    participantRank(matchCopy("punishedPlayers"), round.punishedPlayers),
  ].filter(Boolean);
  const debugOpen = state.roundDebugOpenKey === detailKey;

  return `
    <div class="round-detail-body">
      ${roundDetailSection(matchCopy("recordSummary"), roundPrimaryFacts(round), "round-detail-primary")}
      ${roundDetailSection(matchCopy("combatData"), roundCombatFacts(round))}
      ${roundDetailSection(matchCopy("serverInfo"), roundServerFacts(round))}
      ${roundDetailSection(matchCopy("identityInfo"), roundIdentityFacts(round))}
      ${timeline.length ? `
        <section class="round-detail-section round-detail-timeline">
          <h3>${escapeHtml(matchCopy("evidenceTimeline"))}</h3>
          <div class="round-timeline">
            ${timeline.map(timelineItem).join("")}
          </div>
        </section>
      ` : ""}
      ${participantBlocks.length ? `
        <section class="round-detail-section round-detail-participants">
          <h3>${escapeHtml(matchCopy("participants"))}</h3>
          <div class="round-rank-grid">
            ${participantBlocks.join("")}
          </div>
        </section>
      ` : ""}
      <section class="round-detail-section round-debug">
        <button type="button" class="round-debug-toggle" data-action="toggle-round-debug" data-round-key="${escapeAttribute(detailKey)}" aria-expanded="${debugOpen}">
          ${escapeHtml(debugOpen ? matchCopy("hideDebug") : matchCopy("showDebug"))}
        </button>
        ${debugOpen ? `<div class="round-debug-grid">${roundDebugFacts(round).map(roundFactRow).join("")}</div>` : ""}
      </section>
    </div>
  `;
}

function roundFact(label, value, tone = "") {
  const resolvedTone = metricTone(value, tone);
  return `
    <div class="round-fact ${escapeAttribute(resolvedTone)}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(displayFactValue(value))}</strong>
    </div>
  `;
}

function roundDetailSection(title, facts, className = "") {
  if (!facts.some((fact) => hasDisplayValue(fact.value))) return "";
  return `
    <section class="round-detail-section ${escapeAttribute(className)}">
      <h3>${escapeHtml(title)}</h3>
      <div class="round-fact-list">
        ${facts.map(roundFactRow).join("")}
      </div>
    </section>
  `;
}

function roundFactRow(fact) {
  const resolvedTone = metricTone(fact.value, fact.tone ?? "");
  return `
    <div class="round-fact-row ${escapeAttribute(resolvedTone)}">
      <span>${escapeHtml(fact.label)}</span>
      <strong>${escapeHtml(displayFactValue(fact.value))}</strong>
    </div>
  `;
}

function roundPrimaryFacts(round) {
  return [
    { label: matchCopy("result"), value: resultLabel(round.result) },
    { label: matchCopy("resultReason"), value: round.resultReason },
    { label: t("matches.duration"), value: round.duration ?? formatDurationFromSeconds(round.durationSeconds) },
    { label: matchCopy("startAt"), value: formatDateTime(round.startAt) },
    { label: matchCopy("endAt"), value: formatDateTime(round.endAt) },
    { label: matchCopy("startReason"), value: round.startReason },
    { label: matchCopy("endReason"), value: round.endReason },
    { label: matchCopy("roundKind"), value: round.roundKind },
    { label: matchCopy("resultEligible"), value: booleanText(round.resultEligible) },
  ];
}

function roundCombatFacts(round) {
  const selfKills = playerSelfKills(round);
  const selfDeaths = playerSelfDeaths(round);
  const totalKills = round.kills ?? 0;
  const totalDeaths = round.deaths ?? 0;
  const totalBeds = round.bedDestroys ?? 0;
  const ownFinalDeaths = round.ownFinalDeaths ?? 0;
  const beds = playerBedDestroys(round);
  const playerKillStreak = round.playerMaxKillStreak ?? 0;
  return [
    { label: t("matches.selfKills"), value: formatNumber(selfKills), tone: positiveTone(selfKills) },
    { label: t("matches.deaths"), value: formatNumber(selfDeaths), tone: deathTone(selfDeaths) },
    { label: "K/D", value: formatRatio(selfKills, selfDeaths), tone: positiveTone(selfKills) },
    { label: matchCopy("beds"), value: formatNumber(beds), tone: positiveTone(beds) },
    { label: matchCopy("playerMaxKillStreak"), value: formatNumber(playerKillStreak), tone: positiveTone(playerKillStreak) },
    { label: matchCopy("totalKills"), value: formatNumber(totalKills) },
    { label: matchCopy("totalDeaths"), value: formatNumber(totalDeaths) },
    { label: matchCopy("totalBeds"), value: formatNumber(totalBeds) },
    { label: matchCopy("ownFinalDeaths"), value: formatNumber(ownFinalDeaths), tone: deathTone(ownFinalDeaths) },
  ];
}

function roundServerFacts(round) {
  const evidence = round.serverEvidence ?? {};
  return [
    { label: matchCopy("server"), value: roundServerLabel(round) },
    { label: matchCopy("serverNetwork"), value: round.serverNetwork },
    { label: matchCopy("serverAddress"), value: round.serverAddress },
    { label: matchCopy("serverConfidence"), value: round.serverConfidence },
    { label: matchCopy("serverEvidence"), value: compactEvidence(evidence) },
  ];
}

function roundIdentityFacts(round) {
  return [
    { label: matchCopy("serverPlayerId"), value: round.serverPlayerId },
    { label: matchCopy("serverPlayerIdSource"), value: round.serverPlayerIdSource },
    { label: matchCopy("serverPlayerIdConfidence"), value: round.serverPlayerIdConfidence },
    { label: matchCopy("serverIdentityContext"), value: round.serverIdentityContext },
    { label: matchCopy("ownerTeam"), value: round.ownerTeam },
    { label: matchCopy("ownerBedDestroyed"), value: booleanText(round.ownerBedDestroyed) },
    { label: matchCopy("ownerTeamEliminated"), value: booleanText(round.ownerTeamEliminated) },
  ];
}

function roundEvidenceTimeline(round) {
  const boundary = Array.isArray(round.boundaryEvents) ? round.boundaryEvents.map((event) => ({
    kind: event.role || event.type || matchCopy("boundary"),
    detail: [event.type, event.ruleSet, event.ruleId].filter(Boolean).join(" / "),
    at: event.timestampMs ? formatDateTime(event.timestampMs) : "",
    line: event.lineNo,
  })) : [];
  const result = Array.isArray(round.resultEvidence) ? round.resultEvidence.map((event) => ({
    kind: event.result ? `${event.kind || "result"}: ${resultLabel(event.result)}` : (event.kind || matchCopy("result")),
    detail: [event.reason, event.ruleSet, event.ruleId].filter(Boolean).join(" / "),
    at: event.timestampMs ? formatDateTime(event.timestampMs) : "",
    line: event.lineNo,
  })) : [];
  return [...boundary, ...result].slice(0, 8);
}

function roundDebugFacts(round) {
  return [
    { label: "source", value: round.source },
    { label: "scope", value: round.scope },
    { label: "filePath", value: round.filePath },
    { label: "lineNo", value: round.lineNo },
    { label: "key", value: round.key },
    { label: "localUser", value: round.localUser },
    { label: "sessionAlias", value: round.sessionAlias },
    { label: "launcherUser", value: round.launcherUser },
    { label: "resultHint", value: compactObject(round.resultHint) },
    { label: "unknownAudit", value: compactObject(round.unknownAudit) },
    { label: "ownerAliasesUsed", value: compactObject(round.ownerAliasesUsed) },
    { label: "identityPropagation", value: compactObject(round.identityPropagation) },
    { label: "propagatedServerPlayerIds", value: compactObject(round.propagatedServerPlayerIds) },
  ];
}

function timelineItem(item) {
  return `
    <div class="round-timeline-item">
      <span>${escapeHtml(displayFactValue(item.at || item.line ? [item.at, item.line ? `#${item.line}` : ""].filter(Boolean).join(" ") : ""))}</span>
      <strong>${escapeHtml(displayFactValue(item.kind))}</strong>
      ${item.detail ? `<p>${escapeHtml(item.detail)}</p>` : ""}
    </div>
  `;
}

function participantRank(title, record) {
  const entries = topRecordEntries(record, 5);
  if (!entries.length) return "";
  return `
    <div class="round-rank-card">
      <h4>${escapeHtml(title)}</h4>
      ${entries.map(([name, value]) => `
        <div>
          <span>${escapeHtml(name)}</span>
          <strong>${escapeHtml(formatNumber(value))}</strong>
        </div>
      `).join("")}
    </div>
  `;
}

function topRecordEntries(record, limit = 5) {
  if (!record || typeof record !== "object" || Array.isArray(record)) return [];
  return Object.entries(record)
    .filter(([, value]) => Number(value) > 0)
    .sort((a, b) => Number(b[1]) - Number(a[1]) || a[0].localeCompare(b[0]))
    .slice(0, limit);
}

function roundServerLabel(round) {
  return displayScope(round.serverLabel ?? round.serverNetwork ?? t("common.unknown"));
}

function compactEvidence(evidence) {
  if (!evidence || typeof evidence !== "object") return "";
  return [evidence.source, evidence.text, evidence.lineNo ? `#${evidence.lineNo}` : ""].filter(Boolean).join(" / ");
}

function compactObject(value) {
  if (!value || typeof value !== "object") return "";
  if (Array.isArray(value)) return value.length ? JSON.stringify(value) : "";
  const entries = Object.entries(value);
  if (!entries.length) return "";
  return entries.slice(0, 6).map(([key, item]) => `${key}: ${typeof item === "object" ? JSON.stringify(item) : item}`).join("; ");
}

function displayFactValue(value) {
  if (value === true || value === false) return booleanText(value);
  if (value === null || value === undefined || value === "") return missingValue();
  return String(value);
}

function hasDisplayValue(value) {
  if (value === null || value === undefined || value === "") return false;
  return true;
}

function booleanText(value) {
  if (value === true) return matchCopy("yes");
  if (value === false) return matchCopy("no");
  return "";
}

function missingValue() {
  return "—";
}

function matchCopy(key) {
  const copies = {
    zh: {
      yes: "是",
      no: "否",
      result: "结果",
      server: "服务器",
      beds: "破床",
      confidence: "可信度",
      recordSummary: "战绩摘要",
      combatData: "战斗数据",
      serverInfo: "服务器信息",
      identityInfo: "身份信息",
      evidenceTimeline: "证据时间线",
      participants: "参与者排行",
      showDebug: "显示来源与调试",
      hideDebug: "隐藏来源与调试",
      backToMatches: "返回对局",
      backToOverview: "返回总览",
      detailContext: "对局详情",
      resultReason: "结果原因",
      startAt: "开始时间",
      endAt: "结束时间",
      startReason: "开始原因",
      endReason: "结束原因",
      roundKind: "对局类型",
      resultEligible: "计入胜负",
      totalKills: "观测击杀",
      totalDeaths: "观测死亡",
      totalBeds: "观测破床",
      ownFinalDeaths: "最终死亡",
      playerMaxKillStreak: "本人最高连杀",
      serverNetwork: "网络",
      serverAddress: "地址",
      serverConfidence: "识别置信度",
      serverEvidence: "服务器证据",
      serverPlayerId: "局内 ID",
      serverPlayerIdSource: "身份来源",
      serverPlayerIdConfidence: "身份置信度",
      serverIdentityContext: "身份上下文",
      ownerTeam: "队伍",
      ownerBedDestroyed: "床被破坏",
      ownerTeamEliminated: "队伍淘汰",
      boundary: "边界",
      killers: "击杀者",
      victims: "受害者",
      bedDestroyers: "破床者",
      punishedPlayers: "惩罚玩家",
    },
    en: {
      yes: "Yes",
      no: "No",
      result: "Result",
      server: "Server",
      beds: "Beds",
      confidence: "Confidence",
      recordSummary: "Record summary",
      combatData: "Combat data",
      serverInfo: "Server info",
      identityInfo: "Identity info",
      evidenceTimeline: "Evidence timeline",
      participants: "Participants",
      showDebug: "Show source and debug",
      hideDebug: "Hide source and debug",
      backToMatches: "Back to matches",
      backToOverview: "Back to overview",
      detailContext: "Match detail",
      resultReason: "Result reason",
      startAt: "Started",
      endAt: "Ended",
      startReason: "Start reason",
      endReason: "End reason",
      roundKind: "Round kind",
      resultEligible: "Result eligible",
      totalKills: "Observed kills",
      totalDeaths: "Observed deaths",
      totalBeds: "Observed beds",
      ownFinalDeaths: "Final deaths",
      playerMaxKillStreak: "Player max kill streak",
      serverNetwork: "Network",
      serverAddress: "Address",
      serverConfidence: "Server confidence",
      serverEvidence: "Server evidence",
      serverPlayerId: "In-game ID",
      serverPlayerIdSource: "Identity source",
      serverPlayerIdConfidence: "Identity confidence",
      serverIdentityContext: "Identity context",
      ownerTeam: "Team",
      ownerBedDestroyed: "Bed destroyed",
      ownerTeamEliminated: "Team eliminated",
      boundary: "Boundary",
      killers: "Killers",
      victims: "Victims",
      bedDestroyers: "Bed breakers",
      punishedPlayers: "Punished players",
    },
  };
  return copies[state.locale]?.[key] ?? copies.en[key] ?? key;
}

function filterRoundsByQuery(rounds, query) {
  const normalizedQuery = normalizeSearch(query);
  if (!normalizedQuery) return rounds;
  return rounds.filter((round) => roundSearchText(round).includes(normalizedQuery));
}

function roundSearchText(round) {
  return normalizeSearch([
    round.gameMode,
    modeLabel(round.gameMode),
    round.result,
    resultLabel(round.result),
    round.source,
    round.serverLabel,
    round.serverName,
    round.serverNetwork,
    round.serverAddress,
    round.scope,
    round.duration,
    round.startAt,
    formatDateTime(round.startAt),
    formatDate(round.startAt),
  ].join(" "));
}

function modesView(view) {
  const total = view.modes.length;
  const pageCount = pageCountFor(total, state.modesPageSize);
  const page = clampPage(state.modesPage, pageCount);
  if (state.modesPage !== page) state.modesPage = page;
  const modes = pageItems(view.modes, page, state.modesPageSize);
  return `
    <section class="view-pane modes-view">
      <div class="section-head">
        <div>
          <span>${escapeHtml(t("modes.eyebrow"))}</span>
          <h1>${escapeHtml(t("modes.title"))}</h1>
        </div>
        <p>${escapeHtml(t("modes.summary", { count: formatNumber(view.modeIds.length) }))}</p>
      </div>
      ${viewToolbar("modes", state.modesViewMode, total, page, pageCount)}
      ${state.modesViewMode === "list" ? modeList(modes, view) : `<div class="wide-card-grid">${modes.map((mode) => modeDetailCard(mode, view)).join("") || emptyState(t("modes.noRecords"))}</div>`}
      ${paginationControls("modes", page, pageCount, total)}
    </section>
  `;
}

function identityView(view) {
  const total = view.serverIdentityRows.length;
  const pageCount = pageCountFor(total, state.identityPageSize);
  const page = clampPage(state.identityPage, pageCount);
  if (state.identityPage !== page) state.identityPage = page;
  const rows = pageItems(view.serverIdentityRows, page, state.identityPageSize);
  return `
    <section class="view-pane identity-view">
      <div class="section-head">
        <div>
          <span>${escapeHtml(t("identity.eyebrow"))}</span>
          <h1>${escapeHtml(t("identity.title"))}</h1>
        </div>
        <p>${escapeHtml(t("identity.summary", { identities: formatNumber(view.serverIdentityCount), evidence: formatNumber(view.serverIdentityEvidence) }))}</p>
      </div>
      ${viewToolbar("identity", state.identityViewMode, total, page, pageCount)}
      ${state.identityViewMode === "list" ? identityList(rows, page) : `<div class="wide-card-grid">${rows.map((account, index) => identityDetailCard(account, index + page * state.identityPageSize)).join("") || emptyState(t("identity.noRecords"))}</div>`}
      ${paginationControls("identity", page, pageCount, total)}
    </section>
  `;
}

function modeDetailCard(mode, view) {
  const selfKills = modeSelfKills(mode);
  const observedKills = modeObservedKills(mode);
  const server = topServerForMode(mode, view.serverRows);
  return `
    <article class="workbench-card mode-detail">
      ${modeRow(mode, view.maxModeRounds)}
      <div class="mode-detail-grid">
        ${miniMetric(modeUnitMetricLabel(mode), formatNumber(mode.rounds ?? 0))}
        ${miniMetric(t("modes.duration"), mode.duration ?? "0s")}
        ${miniMetric(t("modes.selfKills"), formatNumber(selfKills), positiveTone(selfKills))}
        ${miniMetric(t("modes.kills"), formatNumber(observedKills), positiveTone(observedKills))}
        ${miniMetric(serverCopy("mainServer"), server?.label ?? missingValue())}
      </div>
    </article>
  `;
}

function modeList(modes, view) {
  const maxScore = Math.max(...modes.map((mode) => finiteNumber(mode.rounds)), 1);
  return `
    <div class="ranking-list mode-list-view">
      ${modes.map((mode, index) => modeListRow(mode, index, maxScore, view)).join("") || emptyState(t("modes.noRecords"))}
    </div>
  `;
}

function modeListRow(mode, index, maxScore, view) {
  const rounds = Number(mode.rounds ?? 0);
  const selfKills = modeSelfKills(mode);
  const duration = mode.duration ?? formatDurationFromSeconds(modeDurationSeconds(mode));
  const ratio = maxScore ? clamp(rounds / maxScore, 0, 1) : 0;
  const server = topServerForMode(mode, view.serverRows);
  return `
    <article class="ranking-row mode-row-view">
      <div class="ranking-index">${escapeHtml(formatNumber(index + 1))}</div>
      <div class="ranking-main">
        <strong>${escapeHtml(mode.label ?? mode.id ?? t("common.unknown"))}</strong>
        <span>${escapeHtml(`${modeKillsSummary(mode, rounds, selfKills)} / ${duration}`)}</span>
      </div>
      <div class="ranking-metrics">
        ${rankingMetric(modeUnitMetricLabel(mode), formatNumber(rounds))}
        ${rankingMetric(t("modes.duration"), duration)}
        ${rankingMetric(t("modes.selfKills"), formatNumber(selfKills), positiveTone(selfKills))}
        ${rankingMetric(t("common.winRate"), percent(mode.winRate), positiveTone(mode.winRate))}
        ${rankingMetric("K/D", formatRatio(selfKills, modeSelfDeaths(mode)), positiveTone(selfKills))}
        ${rankingMetric(serverCopy("mainServer"), server?.label ?? missingValue())}
      </div>
      <div class="ranking-progress" aria-hidden="true"><i style="width:${Math.round(ratio * 100)}%"></i></div>
    </article>
  `;
}

function identityDetailCard(account, index) {
  return `
    <article class="workbench-card identity-detail">
      ${identityRow(account, index)}
      <div class="mode-detail-grid">
        ${miniMetric(t("identity.matches"), formatNumber(account.rounds ?? 0))}
        ${miniMetric(t("identity.evidence"), formatNumber(account.evidence ?? 0))}
        ${miniMetric(t("identity.direct"), formatNumber(account.direct ?? 0), positiveTone(account.direct ?? 0))}
      </div>
      <div class="identity-dates">
        <span>${escapeHtml(t("overview.firstSeen"))}: ${escapeHtml(formatDate(account.firstSeenAt))}</span>
        <span>${escapeHtml(t("overview.lastSeen"))}: ${escapeHtml(formatDate(account.lastSeenAt))}</span>
      </div>
    </article>
  `;
}

function identityList(rows, page) {
  const maxScore = Math.max(...rows.map((account) => finiteNumber(account.rounds, account.evidence)), 1);
  return `
    <div class="ranking-list identity-list-view">
      ${rows.map((account, index) => identityListRow(account, index + page * state.identityPageSize, maxScore)).join("") || emptyState(t("identity.noRecords"))}
    </div>
  `;
}

function identityListRow(account, index, maxScore) {
  const name = account.name ?? account.serverPlayerId ?? account.user ?? "unknown";
  const rounds = Number(account.rounds ?? 0);
  const evidence = Number(account.evidence ?? 0);
  const direct = Number(account.direct ?? 0);
  const ratio = maxScore ? clamp(finiteNumber(rounds, evidence) / maxScore, 0, 1) : 0;
  const sourceText = [
    account.scopeCount ? `${formatNumber(account.scopeCount)} ${t("common.sources")}` : "",
    account.duration ? account.duration : "",
  ].filter(Boolean).join(" / ");
  return `
    <article class="ranking-row identity-row-view ${index === 0 ? "primary" : ""}">
      <div class="ranking-index">${escapeHtml(formatNumber(index + 1))}</div>
      <div class="ranking-main">
        <strong>${escapeHtml(name)}</strong>
        <span>${escapeHtml(sourceText || t("identity.evidence"))}</span>
      </div>
      <div class="ranking-metrics">
        ${rankingMetric(t("identity.matches"), formatNumber(rounds))}
        ${rankingMetric(t("identity.evidence"), formatNumber(evidence))}
        ${rankingMetric(t("identity.direct"), formatNumber(direct), positiveTone(direct))}
        ${rankingMetric(t("overview.firstSeen"), formatDate(account.firstSeenAt))}
        ${rankingMetric(t("overview.lastSeen"), formatDate(account.lastSeenAt))}
      </div>
      <div class="ranking-progress" aria-hidden="true"><i style="width:${Math.round(ratio * 100)}%"></i></div>
    </article>
  `;
}

function rankingMetric(label, value, tone = "") {
  const valueClass = metricValueClass(label);
  const resolvedTone = metricTone(value, tone);
  return `
    <div class="${escapeAttribute(resolvedTone)}">
      <span>${escapeHtml(label)}</span>
      <strong class="${escapeAttribute(valueClass)}">${metricValueHtml(label, value)}</strong>
    </div>
  `;
}

function viewToolbar(kind, viewMode, total, page, pageCount) {
  return `
    <div class="view-toolbar">
      <div>
        <span>${escapeHtml(uiCopy("showingPage", { page: formatNumber(page + 1), pages: formatNumber(pageCount) }))}</span>
        <strong>${escapeHtml(uiCopy("totalItems", { count: formatNumber(total) }))}</strong>
      </div>
      ${kind === "matches" ? matchSortToggle() : ""}
      <div class="view-mode-toggle" aria-label="${escapeAttribute(uiCopy("viewMode"))}">
        ${viewModeButton(kind, "cards", uiCopy("cards"), viewMode)}
        ${viewModeButton(kind, "list", uiCopy("list"), viewMode)}
      </div>
    </div>
  `;
}

function matchSortToggle() {
  const sort = state.matchesSort === "oldest" ? "oldest" : "newest";
  return `
    <div class="match-sort-toggle" aria-label="${escapeAttribute(uiCopy("matchSort"))}">
      ${matchSortButton("newest", uiCopy("newest"), sort)}
      ${matchSortButton("oldest", uiCopy("oldest"), sort)}
    </div>
  `;
}

function matchSortButton(value, label, selected) {
  return `
    <button type="button" class="${selected === value ? "active" : ""}" data-action="set-match-sort" data-match-sort="${escapeAttribute(value)}" aria-pressed="${selected === value}">
      ${escapeHtml(label)}
    </button>
  `;
}

function viewModeButton(kind, value, label, selected) {
  return `
    <button type="button" class="${selected === value ? "active" : ""}" data-action="set-view-mode" data-view-kind="${escapeAttribute(kind)}" data-view-mode="${escapeAttribute(value)}" aria-pressed="${selected === value}">
      ${escapeHtml(label)}
    </button>
  `;
}

function paginationControls(kind, page, pageCount, total) {
  if (pageCount <= 1 && total <= pageSizeForKind(kind)) return "";
  return `
    <nav class="pagination-controls" aria-label="${escapeAttribute(uiCopy("pagination"))}">
      <button type="button" data-action="change-page" data-page-kind="${escapeAttribute(kind)}" data-page-step="-1" ${page <= 0 ? "disabled" : ""}>${escapeHtml(uiCopy("previous"))}</button>
      <span>${escapeHtml(uiCopy("pageOf", { page: formatNumber(page + 1), pages: formatNumber(pageCount) }))}</span>
      <button type="button" data-action="change-page" data-page-kind="${escapeAttribute(kind)}" data-page-step="1" ${page >= pageCount - 1 ? "disabled" : ""}>${escapeHtml(uiCopy("next"))}</button>
    </nav>
  `;
}

function pageSizeForKind(kind) {
  if (kind === "matches") return state.matchesPageSize;
  if (kind === "modes") return state.modesPageSize;
  if (kind === "identity") return state.identityPageSize;
  if (kind === "audit") return state.auditPageSize;
  return 12;
}

function pageCountFor(total, pageSize) {
  return Math.max(1, Math.ceil(Number(total ?? 0) / pageSize));
}

function clampPage(page, pageCount) {
  return Math.max(0, Math.min(Number(page) || 0, Math.max(0, pageCount - 1)));
}

function pageItems(items, page, pageSize) {
  const start = page * pageSize;
  return items.slice(start, start + pageSize);
}

function shareKindForTab(tab) {
  return ["matches", "modes", "identity"].includes(tab) ? tab : "overview";
}

function shareView(view) {
  const data = buildShareCardData(view, {
    kind: state.shareKind,
    modeMetric: state.shareModeMetric,
    primaryBar: state.sharePrimaryBar,
    secondaryBar: state.shareSecondaryBar,
  });
  const frame = state.shareFrame;
  const includedItems = data.includedItems ?? [t("share.includedName"), t("common.winRate"), "K/D", t("share.includedWinLoss"), t("share.includedStreak"), t("share.includedTape"), shareCopy("modeMix")];
  return `
    <section class="view-pane share-view" id="share">
      <div class="section-head">
        <div>
          <span>${escapeHtml(t("share.eyebrow"))}</span>
          <h1>${escapeHtml(t("share.title"))}</h1>
        </div>
        <p>${escapeHtml(t("share.summary"))}</p>
      </div>
      <div class="share-layout">
        <div class="workbench-card share-workbench">
          <div class="share-workbench-head">
            ${profileSummary(view, "share")}
            <div class="share-actions">
              <button type="button" class="secondary-action" data-action="copy-summary">
                ${iconSpan("copy")}
                <span>${escapeHtml(t("actions.copyText"))}</span>
              </button>
              <button type="button" class="primary-action" data-action="download-share-card">
                ${iconSpan("download")}
                <span>${escapeHtml(t("actions.downloadPng"))}</span>
              </button>
            </div>
          </div>
          <div class="share-kind-picker" aria-label="${escapeAttribute(uiCopy("shareKind"))}">
            ${shareKindButton("overview", t("tabs.overview"), data.kind)}
            ${shareKindButton("matches", t("tabs.matches"), data.kind)}
            ${shareKindButton("modes", t("tabs.modes"), data.kind)}
            ${shareKindButton("identity", t("tabs.identity"), data.kind)}
          </div>
          <div class="share-settings-row">
            <div class="share-setting-group frame-setting">
              <span>${escapeHtml(t("share.frame"))}</span>
              <div class="frame-picker" aria-label="${escapeAttribute(t("aria.shareFrame"))}">
                ${frameButton("wide", "16:9", "1600 x 900", frame)}
                ${frameButton("square", "1:1", "1080 x 1080", frame)}
              </div>
            </div>
            <div class="share-setting-group mode-metric-picker" aria-label="${escapeAttribute(shareCopy("modeMetric"))}">
              <span>${escapeHtml(shareCopy("modeMetric"))}</span>
              <div>
                ${modeMetricButton("rounds", shareCopy("modeByRounds"), data.modeMetric)}
                ${modeMetricButton("playtime", shareCopy("modeByPlaytime"), data.modeMetric)}
              </div>
            </div>
            <div class="share-setting-group share-bar-picker" aria-label="${escapeAttribute(shareCopy("barSlots"))}">
              <span>${escapeHtml(shareCopy("barSlots"))}</span>
              <div>
                ${shareBarSelect("primary", data.shareBars[0])}
                ${shareBarSelect("secondary", data.shareBars[1])}
              </div>
            </div>
          </div>
          ${shareStatPicker(data, frame)}
          <div class="share-preview-wrap">
            <div class="share-preview-head">
              <span>${escapeHtml(t("share.preview"))}</span>
              ${chip(frame === "square" ? "1080 x 1080" : "1600 x 900")}
              <small>${escapeHtml(frame === "square" ? t("share.square") : t("share.wide"))}</small>
            </div>
            <div class="share-preview-body" aria-busy="false">
              <div class="share-preview-stage">
                ${renderSharePreview(data, frame)}
              </div>
              <aside class="share-side-panel">
                <div class="share-side-heading">
                  <span>${escapeHtml(data.cardTitle)}</span>
                  <strong>${escapeHtml(data.playerName)}</strong>
                  <small>${escapeHtml(data.cardSubtitle)}</small>
                </div>
                <div class="share-poster-stats" aria-label="${escapeAttribute(t("share.includedData"))}">
                  ${posterStat(t("common.winRate"), data.winRate, positiveTone(data.winRate))}
                  ${posterStat("K/D", data.selfKd, positiveTone(data.selfKills))}
                </div>
                <div class="share-poster-support">
                  ${posterStat(data.primaryMetricLabel, data.primaryMetricValue)}
                  ${posterStat(t("overview.peakStreak"), data.peakStreak, positiveTone(data.peakStreak))}
                </div>
                ${data.shareBars.map((bar) => renderShareBar(data, bar, frame)).join("")}
                <div class="share-poster-footer">
                  <div class="share-meta">
                    ${data.meta.filter(([label]) => ![t("common.winRate"), t("share.reliableRounds"), data.primaryMetricLabel].includes(label)).map(([label, value]) => shareMeta(label, value)).join("")}
                    ${shareMeta(t("share.generatedAt"), data.generated)}
                  </div>
                  <div class="included-box">
                    <span>${escapeHtml(t("share.included"))}</span>
                    <div class="included-token-list" role="list">${includedItems.map((item) => includedToken(item)).join("")}</div>
                  </div>
                </div>
              </aside>
            </div>
          </div>
        </div>
      </div>
    </section>
  `;
}

function auditView(view) {
  const audit = view.audit;
  const total = Number(audit.rounds?.total ?? audit.items.length);
  const pageCount = pageCountFor(total, state.auditPageSize);
  const page = clampPage(state.auditPage, pageCount);
  if (state.auditPage !== page) state.auditPage = page;
  return `
    <section class="view-pane audit-view">
      ${auditOobePanel(view)}
      ${auditFlowRail(view)}
      ${auditOverviewPanel(view)}
      <div class="audit-workbench-grid">
        <section class="audit-queue-panel">
          <div class="audit-panel-head">
            <div>
              <span>${escapeHtml(auditCopy("unknownQueue"))}</span>
              <strong>${escapeHtml(auditCopy("reviewRowsHint"))}</strong>
            </div>
            ${chip(`${formatNumber(total)} ${t("common.records")}`)}
          </div>
          <div class="audit-queue-tools">
            ${auditFilterBar(view)}
            ${paginationControls("audit", page, pageCount, total)}
          </div>
          <div class="audit-queue-list">
            ${audit.items.map((round) => auditQueueRow(round)).join("") || emptyState(auditCopy("noUnknownRows"))}
          </div>
        </section>
        <section class="audit-detail-panel">
          ${auditReviewPanel(audit.activeRound)}
          ${auditWorkflowPanel(view)}
        </section>
      </div>
      <div class="audit-lower-grid">
        <section class="audit-rule-lab audit-surface">
          ${ruleToolPanel(view)}
          ${ruleDiagnosticsPanel(view)}
        </section>
        <section class="audit-rule-library audit-surface">
          ${rulePackPanel(view)}
        </section>
      </div>
    </section>
  `;
}

function auditOobePanel(view) {
  if (!state.auditOobeOpen) return "";
  const total = Number(view.audit.rounds?.total ?? view.audit.items.length ?? 0);
  const rulePackCount = Number(view.audit.rulePacks?.total ?? view.audit.rulePacks?.items?.length ?? 0);
  return `
    <section class="audit-oobe">
      <div class="audit-oobe-copy">
        <span>${escapeHtml(auditCopy("oobeEyebrow"))}</span>
        <h1>${escapeHtml(auditCopy("oobeTitle"))}</h1>
        <p>${escapeHtml(auditCopy("oobeSummary"))}</p>
      </div>
      <div class="audit-oobe-steps" aria-label="${escapeAttribute(auditCopy("flowTitle"))}">
        ${auditOobeStep("checklist", auditCopy("oobeStepQueue"), auditCopy("oobeStepQueueDetail", { count: formatNumber(total) }))}
        ${auditOobeStep("flask", auditCopy("oobeStepLabel"), auditCopy("oobeStepLabelDetail"))}
        ${auditOobeStep("database", auditCopy("oobeStepRules"), auditCopy("oobeStepRulesDetail", { count: formatNumber(rulePackCount) }))}
      </div>
      <button type="button" class="icon-btn close-oobe" data-action="dismiss-audit-oobe" aria-label="${escapeAttribute(auditCopy("dismissOobe"))}" title="${escapeAttribute(auditCopy("dismissOobe"))}">
        ${iconSpan("x")}
      </button>
    </section>
  `;
}

function auditOobeStep(icon, title, detail) {
  return `
    <article>
      ${iconSpan(icon)}
      <div>
        <strong>${escapeHtml(title)}</strong>
        <span>${escapeHtml(detail)}</span>
      </div>
    </article>
  `;
}

function auditFlowRail(view) {
  const step = auditCurrentStep(view);
  const steps = [
    ["queue", "checklist", auditCopy("flowQueue"), auditCopy("flowQueueHint")],
    ["label", "route", auditCopy("flowLabel"), auditCopy("flowLabelHint")],
    ["dryRun", "flask", auditCopy("flowDryRun"), auditCopy("flowDryRunHint")],
    ["rules", "database", auditCopy("flowRules"), auditCopy("flowRulesHint")],
  ];
  return `
    <section class="audit-flow-rail">
      <div>
        <span>${escapeHtml(auditCopy("flowTitle"))}</span>
        <strong>${escapeHtml(auditCopy("flowSubtitle"))}</strong>
      </div>
      <ol>
        ${steps.map(([id, icon, label, hint]) => `
          <li class="${id === step ? "active" : ""}">
            ${iconSpan(icon)}
            <span>${escapeHtml(label)}</span>
            <small>${escapeHtml(hint)}</small>
          </li>
        `).join("")}
      </ol>
    </section>
  `;
}

function auditCurrentStep(view) {
  const reviewRows = view.audit.reviewRows ?? [];
  if (state.auditWorkflow) return "rules";
  if (state.auditValidation || state.auditStatus) return "dryRun";
  if (reviewRows.length) return "label";
  return "queue";
}

function auditOverviewPanel(view) {
  const resultSummary = view.audit.results?.summary ?? {};
  const unknownAudit = view.audit.results?.unknownAudit ?? {};
  const categories = auditBucketRows(unknownAudit.byCategory);
  const priorities = auditBucketRows(unknownAudit.byPriority);
  const nextActions = auditBucketRows(unknownAudit.byNextAction);
  return `
    <section class="audit-overview-panel">
      <div class="audit-overview-metrics">
        ${auditHeroMetric(auditCopy("unknownQueue"), formatNumber(resultSummary.unknownRoundResults ?? view.diagnostics.unknown), auditCopy("unknownQueueHint"))}
        ${auditHeroMetric(auditCopy("knownCoverage"), percent(resultSummary.knownResultRate ?? view.overview.knownResultRate), auditCopy("knownCoverageHint"))}
        ${auditHeroMetric(auditCopy("reviewRows"), formatNumber(view.audit.rounds?.total ?? 0), auditCopy("reviewRowsHint"))}
      </div>
      <article class="audit-bucket-card priority">
        <span>${escapeHtml(auditCopy("priority"))}</span>
        ${auditBucketList(priorities, "priority")}
      </article>
      <article class="audit-bucket-card category">
        <span>${escapeHtml(auditCopy("category"))}</span>
        ${auditBucketList(categories, "category")}
      </article>
      <article class="audit-bucket-card action">
        <span>${escapeHtml(auditCopy("nextAction"))}</span>
        ${auditBucketList(nextActions, "nextAction")}
      </article>
    </section>
  `;
}

function auditHeroMetric(label, value, detail) {
  return `
    <article class="audit-hero-metric">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <small>${escapeHtml(detail)}</small>
    </article>
  `;
}

function auditFilterBar(view) {
  const categories = auditBucketRows(view.audit.results?.unknownAudit?.byCategory).map((row) => row.key);
  const nextActions = auditBucketRows(view.audit.results?.unknownAudit?.byNextAction).map((row) => row.key);
  return `
    <div class="audit-filter-bar">
      <label>
        <span>${escapeHtml(auditCopy("mode"))}</span>
        ${auditSelect("mode", ["", ...view.modeIds], state.auditFilters.mode, auditCopy("allModes"), modeLabel)}
      </label>
      <label>
        <span>${escapeHtml(auditCopy("priority"))}</span>
        ${auditSelect("priority", ["", "high", "medium", "low"], state.auditFilters.priority, auditCopy("allPriorities"), auditLabel)}
      </label>
      <label>
        <span>${escapeHtml(auditCopy("category"))}</span>
        ${auditSelect("category", ["", ...categories], state.auditFilters.category, auditCopy("allCategories"), auditLabel)}
      </label>
      <label>
        <span>${escapeHtml(auditCopy("nextAction"))}</span>
        ${auditSelect("nextAction", ["", ...nextActions], state.auditFilters.nextAction, auditCopy("allActions"), auditLabel)}
      </label>
      <button type="button" class="secondary-action compact-action" data-action="refresh-audit-data" ${state.auditBusy ? "disabled" : ""}>
        ${iconSpan("refresh")}
        <span>${escapeHtml(auditCopy("refreshAuditData"))}</span>
      </button>
    </div>
  `;
}

function auditSelect(name, options, selected, emptyLabel, labeler = auditLabel) {
  return `
    <select data-audit-filter="${escapeAttribute(name)}" aria-label="${escapeAttribute(name)}">
      ${unique(options).map((value) => `<option value="${escapeAttribute(value)}" ${value === selected ? "selected" : ""}>${escapeHtml(value ? labeler(value) : emptyLabel)}</option>`).join("")}
    </select>
  `;
}

function auditQueueRow(round) {
  const key = auditRoundKey(round);
  const audit = round.unknownAudit ?? {};
  const fallbackKey = state.auditRounds?.items?.[0] ? auditRoundKey(state.auditRounds.items[0]) : "";
  const active = key === (state.activeAuditRoundKey || fallbackKey);
  const draft = state.auditLabels[key] ?? {};
  return `
    <article class="audit-queue-row ${active ? "active" : ""}" data-audit-round-key="${escapeAttribute(key)}">
      <button type="button" data-action="select-audit-round" data-audit-round-key="${escapeAttribute(key)}">
        <span class="audit-row-mode">${escapeHtml(modeLabel(round.gameMode))}</span>
        <strong>${escapeHtml(formatDateTime(round.startAt))}</strong>
        <small>${escapeHtml(roundServerLabel(round))} / ${escapeHtml(round.duration ?? formatDurationFromSeconds(round.durationSeconds))}</small>
      </button>
      <div class="audit-row-tags">
        ${badge(audit.reviewPriority ?? "medium", auditPriorityTone(audit.reviewPriority))}
        ${badge(audit.nextAction ?? auditCopy("unknown"), "blue")}
        ${draft.label ? badge(auditReviewLabel(draft.label), "green") : ""}
      </div>
      <p>${escapeHtml(audit.category ?? auditCopy("noCategory"))}</p>
    </article>
  `;
}

function auditReviewPanel(round) {
  if (!round) {
    return `<article class="audit-review-panel">${emptyState(auditCopy("selectUnknown"))}</article>`;
  }
  const key = auditRoundKey(round);
  const draft = state.auditLabels[key] ?? {};
  const audit = round.unknownAudit ?? {};
  return `
    <article class="audit-review-panel">
      <div class="card-topline">
        <span>${escapeHtml(auditCopy("reviewDetail"))}</span>
        ${badge(audit.reviewPriority ?? "medium", auditPriorityTone(audit.reviewPriority))}
      </div>
      <div class="audit-round-summary">
        <strong>${escapeHtml(modeLabel(round.gameMode))}</strong>
        <span>${escapeHtml(roundServerLabel(round))}</span>
        <span>${escapeHtml(formatDateTime(round.startAt))}</span>
        <span>${escapeHtml(round.duration ?? formatDurationFromSeconds(round.durationSeconds))}</span>
      </div>
      <div class="audit-fact-grid">
        ${miniMetric(auditCopy("category"), audit.category ?? missingValue())}
        ${miniMetric(auditCopy("nextAction"), audit.nextAction ?? missingValue())}
        ${miniMetric(auditCopy("resultHint"), compactResultHint(round.resultHint))}
        ${miniMetric(auditCopy("serverConfidence"), round.serverConfidence ?? missingValue())}
      </div>
      ${auditFeaturePanel(audit.features)}
      <div class="audit-label-editor" data-audit-editor="${escapeAttribute(key)}">
        <div class="audit-label-options" role="group" aria-label="${escapeAttribute(auditCopy("reviewLabel"))}">
          ${AUDIT_REVIEW_LABELS.map((label) => `
            <button type="button" class="${draft.label === label ? "active" : ""}" data-action="set-audit-label" data-audit-label="${escapeAttribute(label)}" data-audit-round-key="${escapeAttribute(key)}" aria-pressed="${draft.label === label}">
              ${escapeHtml(auditReviewLabel(label))}
            </button>
          `).join("")}
        </div>
        <label>
          <span>${escapeHtml(auditCopy("reviewNotes"))}</span>
          <textarea data-audit-field="notes" data-audit-round-key="${escapeAttribute(key)}" rows="2" placeholder="${escapeAttribute(auditCopy("notesPlaceholder"))}">${escapeHtml(draft.notes ?? "")}</textarea>
        </label>
        <label>
          <span>${escapeHtml(auditCopy("exactMessage"))}</span>
          <textarea data-audit-field="message" data-audit-round-key="${escapeAttribute(key)}" rows="2" placeholder="${escapeAttribute(auditCopy("messagePlaceholder"))}">${escapeHtml(draft.message ?? "")}</textarea>
        </label>
        <div class="audit-inline-fields">
          <label>
            <span>${escapeHtml(auditCopy("ruleId"))}</span>
            <input data-audit-field="ruleId" data-audit-round-key="${escapeAttribute(key)}" value="${escapeAttribute(draft.ruleId ?? "")}" placeholder="bedwars_owner_loss_signal">
          </label>
          <label>
            <span>${escapeHtml(auditCopy("confidence"))}</span>
            <select data-audit-field="confidence" data-audit-round-key="${escapeAttribute(key)}">
              ${["", "high", "medium", "low"].map((value) => `<option value="${escapeAttribute(value)}" ${value === (draft.confidence ?? "") ? "selected" : ""}>${escapeHtml(value ? auditLabel(value) : auditCopy("unset"))}</option>`).join("")}
            </select>
          </label>
        </div>
      </div>
    </article>
  `;
}

function auditFeaturePanel(features = {}) {
  const entries = [
    [auditCopy("ownerTeamKnown"), booleanText(features.ownerTeamKnown)],
    [auditCopy("selfAction"), booleanText(features.selfAction)],
    [t("matches.selfKills"), formatNumber(features.selfKills ?? 0)],
    [t("matches.deaths"), formatNumber(features.selfDeaths ?? 0)],
    [matchCopy("beds"), formatNumber(features.selfBedDestroys ?? 0)],
    [matchCopy("ownFinalDeaths"), formatNumber(features.ownFinalDeaths ?? 0)],
    [auditCopy("endReason"), features.endReason ?? missingValue()],
  ];
  const evidenceKinds = Array.isArray(features.evidenceKinds) ? features.evidenceKinds : [];
  return `
    <div class="audit-feature-panel">
      <div class="audit-fact-grid">
        ${entries.map(([label, value]) => miniMetric(label, value)).join("")}
      </div>
      <div class="audit-evidence-kinds">
        <span>${escapeHtml(auditCopy("evidenceKinds"))}</span>
        <div>${evidenceKinds.slice(0, 8).map((item) => badge(item, "neutral")).join("") || badge(auditCopy("none"), "neutral")}</div>
      </div>
    </div>
  `;
}

function auditWorkflowPanel(view) {
  const reviewRows = view.audit.reviewRows;
  return `
    <article class="audit-workflow-panel">
      <div class="card-topline">
        <span>${escapeHtml(auditCopy("labelWorkflow"))}</span>
        ${chip(`${formatNumber(reviewRows.length)} ${t("common.records")}`)}
      </div>
      <div class="audit-action-row">
        <button type="button" class="secondary-action" data-action="audit-status" ${state.auditBusy || !reviewRows.length ? "disabled" : ""}>${escapeHtml(auditCopy("checkStatus"))}</button>
        <button type="button" class="secondary-action" data-action="audit-validate-labels" ${state.auditBusy || !reviewRows.length ? "disabled" : ""}>${escapeHtml(auditCopy("validateLabels"))}</button>
        <button type="button" class="primary-action" data-action="audit-run-workflow" ${state.auditBusy || !reviewRows.length ? "disabled" : ""}>${escapeHtml(auditCopy("runWorkflow"))}</button>
      </div>
      ${auditResponsePanel(auditCopy("statusResult"), state.auditStatus)}
      ${auditResponsePanel(auditCopy("validationResult"), state.auditValidation)}
      ${auditWorkflowResult(state.auditWorkflow)}
    </article>
  `;
}

function auditResponsePanel(title, data) {
  if (!data) return "";
  const rows = [
    [auditCopy("status"), data.status ?? data.readiness?.status ?? missingValue()],
    [auditCopy("nextStep"), data.nextStep ?? data.readiness?.nextStep ?? missingValue()],
    [auditCopy("blockingReason"), data.blockingReason ?? data.readiness?.blockingReason ?? missingValue()],
    [auditCopy("readyForWorkflow"), booleanText(data.readyForWorkflow ?? data.readiness?.canRunDryRun)],
  ];
  return `
    <section class="audit-response-panel">
      <h3>${escapeHtml(title)}</h3>
      <div class="audit-fact-grid">${rows.map(([label, value]) => miniMetric(label, value)).join("")}</div>
    </section>
  `;
}

function auditWorkflowResult(data) {
  if (!data) return "";
  const workflow = data.workflow ?? {};
  const labelSummary = data.labelSummary ?? data.labels ?? {};
  const dryRun = data.dryRun ?? {};
  const draft = data.draft ?? {};
  const writes = data.writes ?? {};
  const rules = Array.isArray(draft.rules) ? draft.rules : [];
  const risks = Array.isArray(dryRun.risks) ? dryRun.risks : [];
  return `
    <section class="audit-response-panel audit-workflow-result">
      <h3>${escapeHtml(auditCopy("workflowResult"))}</h3>
      <div class="audit-fact-grid">
        ${miniMetric("workflow.status", workflow.status ?? missingValue())}
        ${miniMetric("labelSummary.status", labelSummary.status ?? missingValue())}
        ${miniMetric("promotionGate", dryRun.promotionGate?.status ?? missingValue())}
        ${miniMetric(auditCopy("draftRules"), formatNumber(rules.length))}
      </div>
      <div class="audit-write-guard">
        ${["report", "store", "config", "rules"].map((key) => badge(`${key}: ${String(Boolean(writes[key]))}`, Boolean(writes[key]) ? "red" : "green")).join("")}
      </div>
      ${risks.length ? `<div class="audit-risk-list">${risks.slice(0, 5).map((risk) => `<p>${escapeHtml(compactObject(risk))}</p>`).join("")}</div>` : ""}
      ${rules.length ? `<div class="audit-rule-preview">${rules.slice(0, 4).map((rule) => `<code>${escapeHtml(rule.id ?? rule.ruleId ?? compactObject(rule))}</code>`).join("")}</div>` : ""}
    </section>
  `;
}

function ruleToolPanel(view) {
  const modeOptions = unique(["bedwars", ...view.modeIds]).filter(Boolean);
  return `
    <article class="rule-tool-panel">
      <div class="card-topline">
        <span>${escapeHtml(auditCopy("ruleTestLab"))}</span>
        ${chip(auditCopy("noWrites"))}
      </div>
      <div class="rule-tool-form">
        <label>
          <span>${escapeHtml(auditCopy("chatMessage"))}</span>
          <textarea data-rule-field="message" rows="3" placeholder="${escapeAttribute(auditCopy("chatMessagePlaceholder"))}" ${state.auditBusy ? "disabled" : ""}>${escapeHtml(state.auditRuleMessage)}</textarea>
        </label>
        <div class="audit-inline-fields">
          <label>
            <span>${escapeHtml(auditCopy("ruleType"))}</span>
            <select data-rule-field="type" ${state.auditBusy ? "disabled" : ""}>
              ${RULE_DRAFT_TYPES.map((type) => `<option value="${escapeAttribute(type)}" ${state.auditRuleType === type ? "selected" : ""}>${escapeHtml(auditLabel(type))}</option>`).join("")}
            </select>
          </label>
          <label>
            <span>${escapeHtml(auditCopy("targetMode"))}</span>
            <select data-rule-field="mode" ${state.auditBusy ? "disabled" : ""}>
              ${modeOptions.map((mode) => `<option value="${escapeAttribute(mode)}" ${state.auditRuleMode === mode ? "selected" : ""}>${escapeHtml(modeLabel(mode))}</option>`).join("")}
            </select>
          </label>
        </div>
        <div class="audit-action-row">
          <button type="button" class="secondary-action" data-action="rule-test-message" ${state.auditBusy || !state.auditRuleMessage.trim() ? "disabled" : ""}>${escapeHtml(auditCopy("testCurrentRules"))}</button>
          <button type="button" class="primary-action" data-action="rule-draft-message" ${state.auditBusy || !state.auditRuleMessage.trim() ? "disabled" : ""}>${escapeHtml(auditCopy("draftRule"))}</button>
        </div>
      </div>
      ${ruleTestResult(state.auditRuleTest)}
      ${ruleDraftResult(state.auditRuleDraft)}
    </article>
  `;
}

function rulePackPanel(view) {
  const packs = view.audit.rulePacks?.items ?? [];
  const userPacks = (view.audit.userRulePacks?.items?.length ? view.audit.userRulePacks.items : packs.filter((pack) => pack.source === "user"));
  const bundledPacks = packs.filter((pack) => pack.source !== "user");
  return `
    <article class="rule-pack-panel">
      <div class="card-topline">
        <span>${escapeHtml(auditCopy("rulePacks"))}</span>
        ${chip(`${formatNumber(userPacks.length)} ${auditCopy("manageablePacks")}`)}
      </div>
      <div class="rule-pack-section manageable-rule-packs">
        <div class="rule-pack-section-head">
          <div>
            <strong>${escapeHtml(auditCopy("userRulePackManager"))}</strong>
            <span>${escapeHtml(auditCopy("userRulePackManagerHint"))}</span>
          </div>
          ${chip(`${formatNumber(userPacks.length)} ${t("common.items")}`)}
        </div>
        <div class="rule-pack-list user-rule-pack-list">
          ${userPacks.length ? userPacks.slice(0, 8).map((pack) => userRulePackRow(pack)).join("") : noUserRulePacksPanel()}
        </div>
      </div>
      <div class="rule-pack-section rule-pack-editor">
        <div class="rule-pack-section-head">
          <div>
            <strong>${escapeHtml(auditCopy("managedRulePackEditor"))}</strong>
            <span>${escapeHtml(auditCopy("managedRulePackEditorHint"))}</span>
          </div>
        </div>
        <div class="audit-action-row">
          <button type="button" class="secondary-action" data-action="validate-rule-pack-json" ${state.auditBusy ? "disabled" : ""}>${escapeHtml(auditCopy("validateRulePack"))}</button>
          <button type="button" class="secondary-action" data-action="dry-run-rule-pack-json" ${state.auditBusy ? "disabled" : ""}>${escapeHtml(auditCopy("dryRunRulePack"))}</button>
          <button type="button" class="primary-action" data-action="save-rule-pack-json" ${state.auditBusy ? "disabled" : ""}>${escapeHtml(auditCopy("saveUserRulePack"))}</button>
        </div>
        <textarea class="rule-json-field" data-rule-field="packJson" rows="9" spellcheck="false" ${state.auditBusy ? "disabled" : ""}>${escapeHtml(state.auditRulePackJson)}</textarea>
        ${rulePackOperationResults()}
      </div>
      <div class="rule-pack-section readonly-rule-packs">
        <div class="rule-pack-section-head">
          <div>
            <strong>${escapeHtml(auditCopy("bundledRulePacks"))}</strong>
            <span>${escapeHtml(auditCopy("bundledRulePacksHint"))}</span>
          </div>
          ${chip(`${formatNumber(bundledPacks.length)} ${t("common.items")}`)}
        </div>
        <div class="rule-pack-list readonly-rule-pack-list">
          ${bundledPacks.slice(0, 10).map(rulePackRow).join("") || emptyState(auditCopy("noRulePacks"))}
        </div>
      </div>
    </article>
  `;
}

function rulePackRow(pack = {}) {
  return `
    <article class="rule-pack-row readonly-rule-pack-row">
      <div>
        <strong>${escapeHtml(pack.name ?? pack.id ?? auditCopy("unknownRulePack"))}</strong>
        <span>${escapeHtml([pack.id, pack.source ?? pack.category, pack.runtimeSource].filter(Boolean).join(" / "))}</span>
      </div>
      <div>
        ${badge(auditCopy("readOnly"), "neutral")}
        ${badge(pack.enabled ? auditCopy("enabled") : auditCopy("disabled"), pack.enabled ? "green" : "neutral")}
        ${badge(pack.valid === false ? auditCopy("invalid") : auditCopy("valid"), pack.valid === false ? "red" : "green")}
        ${badge(`${formatNumber(pack.rules ?? 0)} ${auditCopy("rules")}`, "neutral")}
      </div>
    </article>
  `;
}

function noUserRulePacksPanel() {
  return `
    <div class="rule-pack-empty-action">
      <strong>${escapeHtml(auditCopy("noUserRulePacks"))}</strong>
      <span>${escapeHtml(auditCopy("noUserRulePacksHint"))}</span>
    </div>
  `;
}

function userRulePackRow(pack = {}) {
  const id = pack.id ?? "";
  return `
    <article class="rule-pack-row user-rule-pack-row">
      <div>
        <strong>${escapeHtml(pack.name ?? id ?? auditCopy("unknownRulePack"))}</strong>
        <span>${escapeHtml([id, pack.modifiedAt ? formatDateTime(pack.modifiedAt) : "", `${formatNumber(pack.rules ?? 0)} ${auditCopy("rules")}`].filter(Boolean).join(" / "))}</span>
      </div>
      <div>
        ${badge(pack.enabled ? auditCopy("enabled") : auditCopy("disabled"), pack.enabled ? "green" : "neutral")}
        ${badge(pack.valid === false ? auditCopy("invalid") : auditCopy("valid"), pack.valid === false ? "red" : "green")}
      </div>
      <div class="rule-pack-row-actions">
        <button type="button" class="secondary-action" data-action="load-user-rule-pack" data-rule-pack-id="${escapeAttribute(id)}" ${state.auditBusy ? "disabled" : ""}>${escapeHtml(auditCopy("loadRulePack"))}</button>
        <button type="button" class="secondary-action rule-pack-toggle" data-action="toggle-user-rule-pack" data-rule-pack-id="${escapeAttribute(id)}" data-rule-pack-enabled="${pack.enabled ? "false" : "true"}" ${state.auditBusy ? "disabled" : ""}>${escapeHtml(pack.enabled ? auditCopy("disableRulePack") : auditCopy("enableRulePack"))}</button>
        <button type="button" class="secondary-action" data-action="load-rule-backups" data-rule-pack-id="${escapeAttribute(id)}" ${state.auditBusy ? "disabled" : ""}>${escapeHtml(auditCopy("showBackups"))}</button>
        <button type="button" class="secondary-action danger" data-action="delete-user-rule-pack" data-rule-pack-id="${escapeAttribute(id)}" ${state.auditBusy ? "disabled" : ""}>${escapeHtml(auditCopy("deleteRulePack"))}</button>
      </div>
    </article>
  `;
}

function rulePackOperationResults() {
  return [
    ruleValidationResult(state.auditRuleValidation),
    ruleDryRunResult(state.auditRuleDryRun),
    rulePackSaveResult(state.auditRulePackSave),
    rulePackDetailResult(state.auditRulePackDetail),
    ruleBackupsResult(state.auditRuleBackups),
  ].filter(Boolean).join("");
}

function ruleTestResult(data) {
  if (!data) return "";
  return `
    <section class="audit-response-panel">
      <h3>${escapeHtml(auditCopy("ruleTestResult"))}</h3>
      <div class="audit-fact-grid">
        ${miniMetric(auditCopy("matched"), booleanText(data.matched))}
        ${miniMetric(auditCopy("inferredMode"), modeLabel(data.inferredGameMode ?? "unknown"))}
      </div>
      ${data.event ? `<div class="rule-code-preview"><code>${escapeHtml(compactObject(data.event))}</code></div>` : ""}
    </section>
  `;
}

function ruleDraftResult(data) {
  if (!data) return "";
  const rule = data.rule ?? {};
  return `
    <section class="audit-response-panel">
      <h3>${escapeHtml(auditCopy("ruleDraftResult"))}</h3>
      <div class="audit-fact-grid">
        ${miniMetric("id", rule.id ?? missingValue())}
        ${miniMetric("type", rule.type ?? missingValue())}
      </div>
      <div class="rule-code-preview"><code>${escapeHtml(rule.pattern ?? compactObject(rule))}</code></div>
    </section>
  `;
}

function ruleValidationResult(data) {
  if (!data) return "";
  const errors = data.errors ?? [];
  return `
    <section class="audit-response-panel">
      <h3>${escapeHtml(auditCopy("validationResult"))}</h3>
      <div class="audit-fact-grid">
        ${miniMetric(auditCopy("status"), data.ok === false ? auditCopy("invalid") : auditCopy("valid"), data.ok === false ? "red" : "green")}
        ${miniMetric(auditCopy("invalid"), formatNumber(errors.length), positiveTone(errors.length, "red"))}
      </div>
      ${errors.length ? `<div class="audit-risk-list">${errors.slice(0, 5).map((error) => `<p>${escapeHtml(compactObject(error))}</p>`).join("")}</div>` : ""}
    </section>
  `;
}

function ruleDryRunResult(data) {
  if (!data) return "";
  const risks = data.risks ?? data.dryRun?.risks ?? [];
  const gate = data.promotionGate ?? data.dryRun?.promotionGate ?? {};
  return `
    <section class="audit-response-panel">
      <h3>${escapeHtml(auditCopy("dryRunResult"))}</h3>
      <div class="audit-fact-grid">
        ${miniMetric("promotionGate", gate.status ?? missingValue())}
        ${miniMetric(auditCopy("roundChanges"), formatNumber(data.roundChanges?.total ?? 0), positiveTone(data.roundChanges?.total ?? 0, "warn"))}
        ${miniMetric(auditCopy("risks"), formatNumber(risks.length), positiveTone(risks.length, "red"))}
      </div>
      ${risks.length ? `<div class="audit-risk-list">${risks.slice(0, 5).map((risk) => `<p>${escapeHtml(compactObject(risk))}</p>`).join("")}</div>` : ""}
    </section>
  `;
}

function rulePackSaveResult(data) {
  if (!data) return "";
  return `
    <section class="audit-response-panel">
      <h3>${escapeHtml(auditCopy("saveResult"))}</h3>
      <div class="audit-fact-grid">
        ${miniMetric("id", data.id ?? missingValue())}
        ${miniMetric(auditCopy("backup"), data.backup?.id ?? auditCopy("none"))}
      </div>
    </section>
  `;
}

function rulePackDetailResult(data) {
  if (!data) return "";
  return `
    <section class="audit-response-panel">
      <h3>${escapeHtml(auditCopy("loadedRulePack"))}</h3>
      <div class="audit-fact-grid">
        ${miniMetric("id", data.id ?? missingValue())}
        ${miniMetric(auditCopy("rules"), formatNumber(data.rules ?? data.rulePack?.rules?.length ?? 0))}
        ${miniMetric(auditCopy("enabled"), booleanText(data.enabled))}
        ${miniMetric(auditCopy("valid"), booleanText(data.valid))}
      </div>
    </section>
  `;
}

function ruleBackupsResult(data) {
  if (!data) return "";
  const items = data.items ?? data.backups ?? [];
  return `
    <section class="audit-response-panel">
      <h3>${escapeHtml(auditCopy("backups"))}</h3>
      <div class="rule-backup-list">
        ${items.slice(0, 8).map((backup) => {
          const id = backup.id ?? backup.backupId ?? "";
          const packId = backup.rulePackId ?? backup.idRulePack ?? state.auditSelectedUserRulePackId;
          return `
            <article>
              <span>${escapeHtml([id, backup.createdAt ? formatDateTime(backup.createdAt) : "", backup.bytes ? `${formatNumber(backup.bytes)} B` : ""].filter(Boolean).join(" / "))}</span>
              <button type="button" class="secondary-action" data-action="restore-rule-backup" data-rule-pack-id="${escapeAttribute(packId)}" data-rule-backup-id="${escapeAttribute(id)}" ${state.auditBusy || !packId || !id ? "disabled" : ""}>${escapeHtml(auditCopy("restoreBackup"))}</button>
            </article>
          `;
        }).join("") || emptyState(auditCopy("noBackups"))}
      </div>
    </section>
  `;
}

function ruleDiagnosticsPanel(view) {
  const rules = view.audit.rulesReport ?? {};
  const doctor = view.audit.rulesDoctor ?? {};
  const auditLog = view.audit.rulesAudit?.items ?? [];
  const quality = rules.quality ?? {};
  const available = rules.available ?? [];
  const warnings = [
    ...(doctor.errors ?? []),
    ...(doctor.warnings ?? []),
    ...(quality.risks ?? []),
  ];
  return `
    <article class="rule-diagnostics-panel">
      <div class="card-topline">
        <span>${escapeHtml(auditCopy("ruleDiagnostics"))}</span>
        ${chip(`${formatNumber(available.length)} ${auditCopy("rulePacks")}`)}
      </div>
      <div class="audit-fact-grid">
        ${miniMetric(auditCopy("selectedRules"), formatNumber((rules.selected ?? []).length))}
        ${miniMetric(auditCopy("eventTypes"), formatNumber(Object.keys(rules.eventCounts ?? {}).length))}
        ${miniMetric(auditCopy("invalid"), formatNumber(doctor.invalid ?? doctor.summary?.invalid ?? 0), positiveTone(doctor.invalid ?? doctor.summary?.invalid ?? 0, "red"))}
        ${miniMetric(auditCopy("auditEvents"), formatNumber(auditLog.length))}
      </div>
      <div class="audit-risk-list">
        ${warnings.slice(0, 6).map((item) => `<p>${escapeHtml(compactObject(item))}</p>`).join("") || `<p>${escapeHtml(auditCopy("noRuleWarnings"))}</p>`}
      </div>
      <div class="rule-audit-list">
        ${auditLog.slice(0, 5).map((item) => `<span>${escapeHtml(formatDateTime(item.createdAt))} / ${escapeHtml(item.action ?? "")} / ${escapeHtml(item.rulePackId ?? "")}</span>`).join("")}
      </div>
    </article>
  `;
}

function auditBucketRows(bucket = {}) {
  if (Array.isArray(bucket)) {
    return bucket.map((row) => ({
      key: row.key ?? row.name ?? row.category ?? row.priority ?? row.nextAction ?? row.id ?? "unknown",
      count: Number(row.count ?? row.total ?? row.value ?? 0),
    }));
  }
  return Object.entries(bucket ?? {}).map(([key, value]) => ({
    key,
    count: typeof value === "object" && value !== null ? Number(value.count ?? value.total ?? 0) : Number(value ?? 0),
  })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

function auditBucketList(rows, type) {
  return `
    <div class="audit-bucket-list">
      ${rows.slice(0, 5).map((row) => `
        <button type="button" data-action="set-audit-filter" data-audit-filter-button="${escapeAttribute(type)}" data-audit-filter-value="${escapeAttribute(row.key)}">
          <span>${escapeHtml(auditLabel(row.key))}</span>
          <b>${formatNumber(row.count)}</b>
        </button>
      `).join("") || `<span>${escapeHtml(auditCopy("none"))}</span>`}
    </div>
  `;
}

function auditRoundKey(round = {}) {
  return String(round.roundRef ?? round.key ?? `${round.source ?? ""}\u0000${round.scope ?? ""}\u0000${round.startAt ?? ""}`);
}

function auditRoundRef(round = {}) {
  return typeof round.roundRef === "string" && round.roundRef ? round.roundRef : null;
}

function auditRoundRefSeed(round = {}) {
  if (!round) return null;
  return {
    roundRef: round.roundRef,
    source: round.source,
    scope: round.scope,
    filePath: round.filePath,
    lineNo: round.lineNo,
    startMs: round.startMs,
    endMs: round.endMs,
  };
}

async function auditRoundRefForApi(round = {}) {
  const direct = auditRoundRef(round);
  if (direct) return direct;
  const text = [
    round.source,
    round.scope,
    round.filePath,
    round.lineNo,
    round.startMs,
    round.endMs,
  ].map((value) => String(value ?? "")).join("\0");
  if (!window.crypto?.subtle) return auditRoundKey(round);
  const bytes = new TextEncoder().encode(text);
  const hash = await window.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

function findAuditRound(key) {
  return (state.auditRounds?.items ?? []).find((round) => auditRoundKey(round) === key) ?? null;
}

function compactResultHint(hint) {
  if (!hint) return missingValue();
  if (typeof hint === "string") return hint;
  return [hint.value, hint.confidence, hint.reason].filter(Boolean).join(" / ") || compactObject(hint);
}

function auditPriorityTone(priority) {
  if (priority === "high") return "red";
  if (priority === "medium") return "warn";
  if (priority === "low") return "blue";
  return "neutral";
}

function badge(label, tone = "neutral") {
  return `<span class="audit-badge ${escapeAttribute(tone)}">${escapeHtml(label)}</span>`;
}


function commandBar(view) {
  const busy = view.refresh?.running;
  const details = commandBarDetails(view);
  return `
    <section class="command-bar ${escapeAttribute(details.tone)}" aria-label="${escapeAttribute(details.label)}">
      <i class="status-dot ${busy ? "busy" : ""}"></i>
      <div class="command-context">
        <strong>${escapeHtml(details.title)}</strong>
        <span>/</span>
        <span>${escapeHtml(busy ? t("refresh.busy") : details.subtitle)}</span>
      </div>
      <div class="command-divider"></div>
      <div class="command-pills">
        ${details.pills.map(([label, value]) => commandPill(label, value)).join("")}
      </div>
      ${details.extra ?? ""}
      <div class="command-divider"></div>
      <div class="command-actions">
        ${details.actions.map((action) => commandAction(action, busy)).join("")}
      </div>
    </section>
  `;
}

function commandBarDetails(view) {
  const activeFilters = [state.filters.result, state.filters.mode, state.filters.source, state.query.trim()].filter(Boolean).length;
  const currentResult = state.filters.result ? resultLabel(state.filters.result) : t("common.all");
  const currentMode = state.filters.mode ? modeLabel(state.filters.mode) : t("common.all");
  const currentSource = state.filters.source || t("common.all");
  const baseActions = (kind) => [
    { action: "refresh-report", label: t("actions.refresh"), icon: "refresh", kind: "secondary" },
    { action: "open-share", shareKind: kind, label: t("actions.exportCard"), icon: "share", kind: "primary" },
  ];

  const views = {
    overview: {
      label: t("command.overviewLabel"),
      tone: "overview-command",
      title: view.playerName,
      subtitle: t("command.reliableSubtitle", { count: formatNumber(view.reliableRecordCount) }),
      pills: [[t("common.files"), formatNumber(view.overview.files)], [t("common.heat"), `${formatNumber(view.calendarGraph.summary.activeDays)} ${t("common.days")}`], [t("common.winRate"), percent(view.overview.winRate)]],
      actions: baseActions("overview"),
    },
    matches: {
      label: t("command.matchesLabel"),
      tone: "matches-command",
      title: t("matches.title"),
      subtitle: t("command.filteredSubtitle", { state: state.query.trim() ? t("command.searching") : t("command.filtered"), count: formatNumber(state.rounds?.total ?? view.recentRounds.length) }),
      pills: [[t("filters.result"), currentResult], [t("filters.mode"), currentMode], [t("filters.source"), currentSource], [t("command.conditions"), activeFilters ? `${formatNumber(activeFilters)} ${t("common.items")}` : t("common.none")]],
      actions: [
        { action: "toggle-filter-panel", label: state.filterPanelOpen ? t("actions.collapseFilters") : t("actions.expandFilters"), icon: "adjustments", kind: "secondary" },
        { action: "clear-filters", label: t("actions.clear"), icon: "x", kind: "secondary" },
        { action: "open-share", shareKind: "matches", label: t("actions.exportCard"), icon: "share", kind: "primary" },
      ],
    },
    modes: {
      label: t("command.modesLabel"),
      tone: "modes-command",
      title: t("modes.title"),
      subtitle: t("command.modeCount", { count: formatNumber(view.modeIds.length) }),
      pills: [[t("command.highest"), view.topModes[0]?.label ?? view.topModes[0]?.id ?? t("common.unknown")], [t("overview.officialMatches"), formatNumber(view.officialMatchCount)], ["K/D", formatRatio(view.overview.selfKills, view.overview.selfDeaths)]],
      actions: baseActions("modes"),
    },
    identity: {
      label: t("command.identityLabel"),
      tone: "identity-command",
      title: t("identity.title"),
      subtitle: t("command.inGameNames", { count: formatNumber(view.serverIdentityCount) }),
      pills: [[t("common.player"), view.playerName], [t("identity.evidence"), formatNumber(view.serverIdentityEvidence)], [t("common.sources"), formatNumber(view.sources.length || 1)]],
      actions: baseActions("identity"),
    },
    audit: {
      label: t("command.auditLabel"),
      tone: "audit-command",
      title: t("command.ruleAudit"),
      subtitle: t("command.candidateSubtitle", { count: formatNumber(view.audit.rounds?.total ?? view.diagnostics.unknown) }),
      pills: [[auditCopy("unknownQueue"), formatNumber(view.audit.rounds?.total ?? 0)], [auditCopy("priority"), auditLabel(state.auditFilters.priority || "all")], [auditCopy("rulePacks"), formatNumber(view.audit.rulePacks?.total ?? view.audit.rulePacks?.items?.length ?? 0)]],
      extra: auditDistribution(view),
      actions: [
        { action: "refresh-report", label: t("actions.refreshAudit"), icon: "refresh", kind: "secondary" },
      ],
    },
  };

  return views[state.activeTab] ?? views.overview;
}

function auditDistribution(view) {
  const items = [
    { key: "reliable", label: t("overview.reliable"), value: Number(view.diagnostics.reliable ?? 0) },
    { key: "unknown", label: t("common.unknown"), value: Number(view.diagnostics.unknown ?? 0) },
    { key: "ignored", label: t("overview.ignored"), value: Number(view.diagnostics.ignored ?? 0) },
  ];
  const total = items.reduce((sum, item) => sum + item.value, 0) || 1;
  return `
    <div class="audit-distribution" aria-label="${escapeAttribute(t("command.auditLabel"))}">
      <div class="audit-distribution-bars" aria-hidden="true">
        ${items.map((item) => `<i class="${escapeAttribute(item.key)}" style="width:${Math.max(2, Math.round((item.value / total) * 100))}%"></i>`).join("")}
      </div>
      <div class="audit-distribution-legend">
        ${items.map((item) => `<span class="${escapeAttribute(item.key)}"><b></b>${escapeHtml(item.label)} ${formatNumber(item.value)}</span>`).join("")}
      </div>
    </div>
  `;
}

function commandAction(action, busy) {
  const disabled = action.action === "refresh-report" && busy ? "disabled" : "";
  return `
    <button type="button" class="${action.kind === "primary" ? "primary-action" : "secondary-action"}" data-action="${escapeAttribute(action.action)}" ${action.shareKind ? `data-share-kind-target="${escapeAttribute(action.shareKind)}"` : ""} ${disabled}>
      ${action.icon ? iconSpan(action.icon) : ""}
      <span>${escapeHtml(action.label)}</span>
    </button>
  `;
}

function toastRegion() {
  const toast = state.toast;
  return `
    <section class="toast-region" aria-live="polite" aria-atomic="true">
      ${toast ? `<div class="toast ${escapeAttribute(toast.tone)}">${escapeHtml(toast.message)}</div>` : ""}
    </section>
  `;
}

function filterSelect(name, values, selected, emptyLabel) {
  return `
    <label class="filter-select">
      <select data-filter="${escapeAttribute(name)}" aria-label="${escapeAttribute(name === "mode" ? t("aria.modeFilter") : t("aria.sourceFilter"))}">
        ${values.map((value) => `<option value="${escapeAttribute(value)}" ${value === selected ? "selected" : ""}>${escapeHtml(value ? optionLabel(name, value) : emptyLabel)}</option>`).join("")}
      </select>
    </label>
  `;
}

function frameButton(value, label, size, selected) {
  return `
    <button type="button" class="${value === selected ? "active" : ""}" data-share-frame="${escapeAttribute(value)}" aria-pressed="${value === selected}">
      ${tablerIcon(value === "square" ? "square" : "rectangle", `frame-icon ${value}`)}
      <strong>${escapeHtml(label)}</strong>
      <small>${escapeHtml(size)}</small>
    </button>
  `;
}

function shareKindButton(value, label, selected) {
  return `
    <button type="button" class="${value === selected ? "active" : ""}" data-action="set-share-kind" data-share-kind="${escapeAttribute(value)}" aria-pressed="${value === selected}">
      <strong>${escapeHtml(label)}</strong>
      <small>${escapeHtml(shareKindSubtitle(value))}</small>
    </button>
  `;
}

function shareKindSubtitle(value) {
  return {
    overview: uiCopy("shareOverview"),
    matches: uiCopy("shareMatches"),
    modes: uiCopy("shareModes"),
    identity: uiCopy("shareIdentity"),
  }[value] ?? value;
}

function profileSummary(view, variant = "") {
  const avatar = avatarModel(view);
  const isShare = variant === "share";
  const showEdit = variant !== "static";
  return `
    <section class="profile-summary ${isShare ? "share-profile-summary" : ""}" aria-label="${escapeAttribute(t("avatar.title"))}">
      <img class="avatar-preview" src="${escapeAttribute(avatar.src)}" width="52" height="52" alt="${escapeAttribute(avatar.alt)}" />
      <div>
        <span>${escapeHtml(t("avatar.title"))}</span>
        <strong>${escapeHtml(view.playerName)}</strong>
        <small>${escapeHtml(avatar.label)}</small>
      </div>
      ${showEdit ? `<button type="button" class="secondary-action profile-edit-action" data-action="open-profile-editor">
        ${iconSpan("userSquare")}
        <span>${escapeHtml(t("avatar.edit"))}</span>
      </button>` : ""}
    </section>
  `;
}

function profileEditorDialog(view) {
  if (!state.profileEditorOpen) return "";
  return `
    <section class="profile-editor-backdrop" role="presentation" data-action="close-profile-editor">
      <aside class="profile-editor" role="dialog" aria-modal="true" aria-label="${escapeAttribute(t("avatar.title"))}" data-profile-editor>
        <div class="profile-editor-head">
          <div>
            <span>${escapeHtml(t("avatar.title"))}</span>
            <strong>${escapeHtml(t("avatar.edit"))}</strong>
            <small>${escapeHtml(t("avatar.summary"))}</small>
          </div>
          <button type="button" class="icon-btn compact" data-action="close-profile-editor" aria-label="${escapeAttribute(t("avatar.close"))}" title="${escapeAttribute(t("avatar.close"))}">
            ${iconSpan("x")}
          </button>
        </div>
        ${avatarPicker(view)}
      </aside>
    </section>
  `;
}

function avatarPicker(view) {
  const avatar = avatarModel(view);
  const aliases = profileAliasOptions(view);
  const draftName = state.profileDraftName ?? view.playerName ?? "";
  const selectedAlias = aliases.includes(draftName) ? draftName : "";
  const shownAliases = aliases.slice(0, 18);
  const aliasPanelId = "profile-aliases-editor";
  const fallback = state.avatarFallback;
  const busy = state.avatarLoading;
  const disabled = busy ? "disabled" : "";
  return `
    <section class="avatar-picker profile-picker" aria-label="${escapeAttribute(t("avatar.title"))}">
      <div class="avatar-picker-head ${busy ? "is-loading" : ""}">
        <img class="avatar-preview" src="${escapeAttribute(avatar.src)}" width="48" height="48" alt="${escapeAttribute(avatar.alt)}" />
        <div>
          <span>${escapeHtml(t("avatar.title"))}</span>
          <strong>${escapeHtml(busy ? t("avatar.loadingAction") : avatar.label)}</strong>
          <small>${escapeHtml(t("avatar.subtitle"))}</small>
        </div>
      </div>
      <div class="avatar-alias-drawer ${state.profileAliasOpen ? "open" : ""}">
        <button type="button" class="avatar-alias-toggle" data-action="toggle-profile-aliases" aria-expanded="${state.profileAliasOpen}" aria-controls="${escapeAttribute(aliasPanelId)}" ${aliases.length && !busy ? "" : "disabled"}>
          <span>
            <b>${escapeHtml(t("avatar.aliasLabel"))}</b>
            <small>${escapeHtml(aliases.length ? t("avatar.aliasCount", { count: formatNumber(aliases.length) }) : t("avatar.noAliases"))}</small>
          </span>
          <i aria-hidden="true"></i>
        </button>
        ${state.profileAliasOpen && aliases.length ? `
          <div class="avatar-alias-panel" id="${escapeAttribute(aliasPanelId)}">
            ${shownAliases.map((name) => `
              <button type="button" class="${name === selectedAlias ? "active" : ""}" data-action="fill-profile-name" data-alias-name="${escapeAttribute(name)}" aria-pressed="${name === selectedAlias}" ${disabled}>
                <span>${escapeHtml(name)}</span>
              </button>
            `).join("")}
          </div>
        ` : ""}
      </div>
      <label class="avatar-username">
        <span>${escapeHtml(t("avatar.usernameLabel"))}</span>
        <input type="text" data-profile-name value="${escapeAttribute(draftName)}" placeholder="${escapeAttribute(t("avatar.usernamePlaceholder"))}" autocomplete="off" spellcheck="false" ${disabled} />
      </label>
      <div class="avatar-actions">
        <button type="button" class="primary-action" data-action="save-player-profile" ${disabled}>
          ${busy ? '<span class="spinner-icon" aria-hidden="true"></span>' : iconSpan("userSquare")}
          <span>${escapeHtml(busy ? t("avatar.loadingAction") : t("avatar.load"))}</span>
        </button>
        <label class="secondary-action avatar-upload ${busy ? "disabled" : ""}">
          <input type="file" data-avatar-upload accept="image/png,image/jpeg,image/webp" ${disabled} />
          <span>${escapeHtml(t("avatar.upload"))}</span>
        </label>
        <button type="button" class="secondary-action" data-action="reset-avatar" ${disabled}>${escapeHtml(t("avatar.reset"))}</button>
      </div>
      ${fallback ? `
        <div class="avatar-fallback">
          <strong>${escapeHtml(t("avatar.fallbackTitle"))}</strong>
          <span>${escapeHtml(t("avatar.fallbackDetail", { username: fallback.username }))}</span>
          <small>${escapeHtml(t("avatar.fallbackReason", { reason: fallback.message }))}</small>
          <div class="avatar-actions">
            <label class="secondary-action avatar-upload ${busy ? "disabled" : ""}">
              <input type="file" data-avatar-upload accept="image/png,image/jpeg,image/webp" ${disabled} />
              <span>${escapeHtml(t("avatar.upload"))}</span>
            </label>
            <button type="button" class="secondary-action" data-action="reset-avatar" ${disabled}>${escapeHtml(t("avatar.reset"))}</button>
            <button type="button" class="secondary-action" data-action="dismiss-avatar-fallback" ${disabled}>${escapeHtml(t("avatar.keepCurrent"))}</button>
          </div>
        </div>
      ` : ""}
    </section>
  `;
}

function modeMetricButton(value, label, selected) {
  return `
    <button type="button" class="${value === selected ? "active" : ""}" data-share-mode-metric="${escapeAttribute(value)}" aria-pressed="${value === selected}">
      <strong>${escapeHtml(label)}</strong>
    </button>
  `;
}

function shareStatPicker(data, frame) {
  const slots = data.statSlots ?? [];
  const selected = new Set(slots);
  const options = shareStatOptions(data).filter((option) => !selected.has(option.key));
  const canAddMore = slots.length < SHARE_STAT_SLOT_LIMIT;
  return `
    <section class="share-stat-picker" aria-label="${escapeAttribute(shareCopy("statSlots"))}">
      <div class="share-stat-picker-head">
        <div>
          <span>${escapeHtml(shareCopy("statSlots"))}</span>
          <small>${escapeHtml(shareCopy(frame === "square" ? "statSquareHint" : "statWideHint"))}</small>
        </div>
        <label class="share-stat-picker-select">
          ${iconSpan("plus")}
          <select data-share-stat-add aria-label="${escapeAttribute(shareCopy("addStat"))}" ${!options.length || !canAddMore ? "disabled" : ""}>
            <option value="">${escapeHtml(options.length ? shareCopy("chooseStat") : shareCopy("noMoreStats"))}</option>
            ${options.map((option) => `<option value="${escapeAttribute(option.key)}">${escapeHtml(option.label)}</option>`).join("")}
          </select>
        </label>
      </div>
      <div class="share-stat-picker-body">
        <div class="share-stat-slots ${slots.length ? "" : "is-empty"}" role="list" aria-label="${escapeAttribute(shareCopy("statSlots"))}">
          ${slots.length ? slots.map((key, index) => shareStatSlotToken(data, key, index)).join("") : `<p>${escapeHtml(shareCopy("statEmpty"))}</p>`}
        </div>
        <div class="share-stat-choices" aria-label="${escapeAttribute(shareCopy("addStat"))}">
          ${options.length ? options.map((option) => shareStatChoiceToken(option, canAddMore)).join("") : `<p>${escapeHtml(shareCopy("noMoreStats"))}</p>`}
        </div>
      </div>
    </section>
  `;
}

function shareStatSlotToken(data, key, index) {
  const stat = shareStatByKey(data, key);
  return `
    <div class="share-stat-token" role="listitem" data-share-stat-slot="${escapeAttribute(key)}" data-share-stat-index="${index}">
      <span class="stat-drag-handle" data-share-stat-drag-handle aria-hidden="true">${tablerIcon("grip")}</span>
      <div>
        <strong>${escapeHtml(stat.label)}</strong>
        <small>${escapeHtml(stat.value)}</small>
      </div>
      <div class="share-stat-token-actions">
        <button type="button" data-action="move-share-stat" data-share-stat="${escapeAttribute(key)}" data-share-stat-step="-1" aria-label="${escapeAttribute(shareCopy("moveStatUp", { label: stat.label }))}" ${index <= 0 ? "disabled" : ""}>${tablerIcon("chevronUp")}</button>
        <button type="button" data-action="move-share-stat" data-share-stat="${escapeAttribute(key)}" data-share-stat-step="1" aria-label="${escapeAttribute(shareCopy("moveStatDown", { label: stat.label }))}" ${index >= data.statSlots.length - 1 ? "disabled" : ""}>${tablerIcon("chevronDown")}</button>
        <button type="button" data-action="remove-share-stat" data-share-stat="${escapeAttribute(key)}" aria-label="${escapeAttribute(shareCopy("removeStat", { label: stat.label }))}">${tablerIcon("x")}</button>
      </div>
    </div>
  `;
}

function shareStatChoiceToken(option, canAddMore) {
  return `
    <button type="button" class="share-stat-choice" data-action="add-share-stat" data-share-stat="${escapeAttribute(option.key)}" ${canAddMore ? "" : "disabled"}>
      <span class="share-stat-choice-head">
        <strong>${escapeHtml(option.label)}</strong>
        ${tablerIcon("plus")}
      </span>
      <small>${escapeHtml(option.value)}</small>
    </button>
  `;
}

function shareBarSelect(slot, selected) {
  const options = ["server", "mode", "result", "tape"];
  return `
    <fieldset class="share-bar-slot">
      <legend>${escapeHtml(slot === "primary" ? shareCopy("barPrimary") : shareCopy("barSecondary"))}</legend>
      <div>
        ${options.map((value) => shareBarButton(slot, value, selected)).join("")}
      </div>
    </fieldset>
  `;
}

function shareBarButton(slot, value, selected) {
  return `
    <button type="button" class="${value === selected ? "active" : ""}" data-share-bar-slot="${escapeAttribute(slot)}" data-share-bar-kind="${escapeAttribute(value)}" aria-pressed="${value === selected}">
      <strong>${escapeHtml(shareBarLabel(value))}</strong>
    </button>
  `;
}

function shareBarLabel(value) {
  return shareCopy({
    server: "serverMix",
    mode: "modeMix",
    result: "resultMix",
    tape: "recentTapeBar",
  }[value] ?? "modeMix");
}

function shareMeta(label, value) {
  return `
    <div>
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `;
}

function quickStat(label, value, tone = "") {
  const valueClass = metricValueClass(label);
  const resolvedTone = metricTone(value, tone);
  return `
    <div class="${escapeAttribute(resolvedTone)}">
      <span>${escapeHtml(label)}</span>
      <strong class="${escapeAttribute(valueClass)}">${metricValueHtml(label, value)}</strong>
    </div>
  `;
}

function posterStat(label, value, tone = "") {
  const valueClass = metricValueClass(label);
  const resolvedTone = metricTone(value, tone);
  return `
    <div class="${escapeAttribute(resolvedTone)}">
      <strong class="${escapeAttribute(valueClass)}">${metricValueHtml(label, value)}</strong>
      <span>${escapeHtml(label)}</span>
    </div>
  `;
}

function metricValueClass(label) {
  const text = String(label ?? "");
  return text === t("modes.duration") || text === t("matches.duration") ? "duration-value" : "";
}

function metricValueHtml(label, value) {
  if (metricValueClass(label) !== "duration-value") {
    return escapeHtml(value);
  }
  const parts = String(value ?? "").trim().split(/\s+/).filter(Boolean);
  const tokens = parts.length ? parts : ["0s"];
  return tokens.map((part) => `<em>${escapeHtml(part)}</em>`).join("");
}

function metricTone(value, preferredTone = "") {
  const tone = String(preferredTone ?? "").trim();
  if (!tone) return isEmptyMetricValue(value) || isZeroMetricValue(value) ? "zero" : "";
  if (["unknown", "ambiguous", "not-applicable"].includes(tone)) return tone;
  if (isEmptyMetricValue(value) || isZeroMetricValue(value)) return "zero";
  if (["win", "loss"].includes(tone)) return tone;
  return tone;
}

function positiveTone(value, tone = "green") {
  return isEmptyMetricValue(value) || isZeroMetricValue(value) ? "zero" : tone;
}

function deathTone(value) {
  if (isEmptyMetricValue(value)) return "zero";
  return isZeroMetricValue(value) ? "zero" : "red";
}

function isEmptyMetricValue(value) {
  const text = String(value ?? "").trim().toLowerCase();
  return !text || text === missingValue() || text === "unknown" || text === t("common.unknown").toLowerCase();
}

function isZeroMetricValue(value) {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return false;
  if (/^0+(?:[.,]0+)?(?:\s*(?:%|s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days))?$/.test(text)) return true;
  if (/^0+(?:[.,]0+)?\s*\/\s*0+(?:[.,]0+)?$/.test(text)) return true;
  return false;
}

function commandPill(label, value) {
  return `
    <span class="command-pill">
      <b>${escapeHtml(label)}</b>
      ${escapeHtml(value)}
    </span>
  `;
}

function cardKicker(label) {
  return `<span class="card-kicker">${escapeHtml(label)}</span>`;
}

function chip(label, tone = "") {
  return `<span class="chip ${tone}">${escapeHtml(label)}</span>`;
}

function includedToken(label) {
  return `<span class="included-token" role="listitem">${escapeHtml(label)}</span>`;
}

function metaRow(label, value) {
  return `
    <div>
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value ?? t("common.unknown"))}</strong>
    </div>
  `;
}

function candidateRow(candidate) {
  return `
    <article class="candidate-row">
      <div>
        <strong>${escapeHtml(candidate.template ?? candidate.rule ?? t("audit.candidateRule"))}</strong>
        <span>${escapeHtml(candidate.examples?.[0] ?? candidate.detail ?? "")}</span>
      </div>
      <b>${formatNumber(candidate.count)}</b>
    </article>
  `;
}

function refreshStatus(refresh) {
  if (!refresh) return "";
  if (!visibleRefresh(refresh)) return "";

  const tone = refresh.error || refreshExitFailed(refresh) ? "error" : refresh.running ? "running" : "done";
  const lastLine = refresh.log?.slice(-1)[0] ?? (refresh.running ? t("refresh.defaultRunningLine") : t("refresh.defaultDoneLine"));

  return `
    <div class="refresh-status ${tone}">
      <span>${escapeHtml(refresh.running ? t("refresh.running") : refresh.error ? t("refresh.failed") : t("refresh.done"))}</span>
      <small>${escapeHtml(lastLine)}</small>
    </div>
  `;
}

function renderSharePreview(data, frame) {
  const theme = shareThemeName(data.theme);
  const spotlightStats = shareSpotlightStats(data);
  const visibleStats = shareSupportingStats(data, frame);

  return `
    <article class="share-preview ${frame}" data-share-theme="${escapeAttribute(theme)}" aria-label="${escapeAttribute(t("aria.sharePreview"))}">
      <div class="share-card-art ${frame} ${escapeAttribute(theme)}">
        <div class="share-card-bg"></div>
        <header class="share-card-head">
          <div>
            ${pixelMark("tiny")}
            <span>MC Log Analytics</span>
            <small>${escapeHtml(data.cardTitle)}</small>
          </div>
          <time>${escapeHtml(data.generated)}</time>
        </header>

        <section class="share-card-hero">
          <section class="share-card-player">
            <img class="share-card-avatar" src="${escapeAttribute(data.avatar.src)}" width="72" height="72" alt="${escapeAttribute(data.avatar.alt)}" />
            <div>
              <h2>${escapeHtml(data.playerName)}</h2>
              <p>${escapeHtml(data.cardSubtitle)}</p>
              <div class="chip-row">
                ${data.badges.map((badge, index) => chip(badge, index === 0 ? "green" : "")).join("")}
              </div>
            </div>
          </section>
          <section class="share-card-spotlight">
            ${spotlightStats.map(shareSpotlightStat).join("")}
          </section>
        </section>
        <div class="share-card-grid support">
          ${visibleStats.map(([label, value, tone]) => previewStat(label, value, tone)).join("")}
        </div>

        <section class="share-wl-bar">
          <strong class="${escapeAttribute(positiveTone(data.wins))}">${escapeHtml(data.wins)}</strong>
          <span class="${escapeAttribute(positiveTone(data.wins))}">${escapeHtml(t("share.win"))}</span>
          <div><i style="width:${Number.parseInt(data.winRate, 10) || 0}%"></i></div>
          <strong class="${escapeAttribute(positiveTone(data.losses, "loss"))}">${escapeHtml(data.losses)}</strong>
          <span class="${escapeAttribute(positiveTone(data.losses, "loss"))}">${escapeHtml(t("share.loss"))}</span>
          <small class="${escapeAttribute(positiveTone(data.peakStreak))}">${escapeHtml(t("share.streak", { value: data.peakStreak }))}</small>
        </section>

        ${data.shareBars.map((bar) => renderShareBar(data, bar, frame)).join("")}

        <footer class="share-card-foot">
          <div>
            ${pixelMark("micro")}
            <span>MC LOG ANALYTICS</span>
          </div>
          <span>${escapeHtml(data.footerMeta)}</span>
        </footer>
      </div>
    </article>
  `;
}

function shareSpotlightStats(data) {
  const winRateFill = clampPercent(Number.parseFloat(String(data.winRate ?? "").replace("%", "")));
  const kdFill = clampPercent(Number.parseFloat(String(data.selfKd ?? "0")) * 10);
  const streakFill = clampPercent(Number.parseFloat(String(data.peakStreak ?? "0").replace(/,/g, "")) * 5);
  return [
    {
      label: t("common.winRate"),
      value: data.winRate,
      note: `${data.wins} ${t("share.win")} / ${data.losses} ${t("share.loss")}`,
      tone: positiveTone(data.winRate),
      kind: "winrate",
      fill: winRateFill,
    },
    {
      label: "KDR",
      value: data.selfKd,
      note: `${formatNumber(data.selfKills)} / ${formatNumber(data.selfDeaths)}`,
      tone: positiveTone(data.selfKills),
      kind: "kdr",
      fill: kdFill,
    },
    {
      label: t("overview.peakStreak"),
      value: data.peakStreak,
      note: `${t("overview.currentWinStreak")} ${data.currentWinStreak}`,
      tone: positiveTone(data.peakStreak),
      kind: "streak",
      fill: streakFill,
    },
  ];
}

function shareSpotlightStat(stat) {
  const tone = metricTone(stat.value, stat.tone);
  const fill = clampPercent(stat.fill);
  return `
    <div class="share-spotlight-card ${escapeAttribute(tone)} ${escapeAttribute(stat.kind)}" style="--spotlight-fill: ${fill}%">
      <span>${escapeHtml(stat.label)}</span>
      <strong>${escapeHtml(stat.value)}</strong>
      <small>${escapeHtml(stat.note)}</small>
      <i class="share-spotlight-meter" aria-hidden="true"><b></b></i>
    </div>
  `;
}

function clampPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, Math.round(number)));
}

function shareSupportingStats(data, frame) {
  return (data.selectedStats ?? []).slice(0, shareStatVisibleLimit(frame)).map((stat) => [stat.label, stat.value, stat.tone]);
}

function shareStatVisibleLimit(frame) {
  return frame === "square" ? 4 : SHARE_STAT_SLOT_LIMIT;
}

function shareStatOptions(data) {
  return SHARE_STAT_OPTION_KEYS.map((key) => shareStatByKey(data, key));
}

function shareStatByKey(data, key) {
  const stats = data.statContext ?? {};
  const topServer = stats.topServer ?? {};
  const topMode = stats.topMode ?? {};
  const label = shareStatLabel(key);
  const fallback = { key, label, value: missingValue(), tone: "" };
  const byKey = {
    playtime: { value: data.playtime, tone: positiveTone(data.playtime) },
    reliableRecords: { value: data.reliableRounds, tone: positiveTone(data.reliableRounds) },
    officialMatches: { value: formatNumber(stats.officialMatches ?? 0), tone: positiveTone(stats.officialMatches) },
    activityRecords: { value: formatNumber(stats.activityRecords ?? 0), tone: positiveTone(stats.activityRecords) },
    wins: { value: data.wins, tone: positiveTone(data.wins) },
    losses: { value: data.losses, tone: positiveTone(data.losses, "loss") },
    selfKills: { value: formatNumber(stats.selfKills ?? data.selfKills ?? 0), tone: positiveTone(stats.selfKills ?? data.selfKills) },
    selfDeaths: { value: formatNumber(stats.selfDeaths ?? data.selfDeaths ?? 0), tone: deathTone(stats.selfDeaths ?? data.selfDeaths) },
    playerBedDestroys: { value: formatNumber(stats.playerBedDestroys ?? 0), tone: positiveTone(stats.playerBedDestroys) },
    currentWinStreak: { value: data.currentWinStreak, tone: positiveTone(data.currentWinStreak) },
    playerMaxKillStreak: { value: data.playerMaxKillStreak, tone: positiveTone(data.playerMaxKillStreak) },
    topServer: { value: topServer.label ?? missingValue() },
    serverCount: { value: formatNumber(stats.serverCount ?? 0), tone: positiveTone(stats.serverCount) },
    topMode: { value: topMode.label ?? topMode.id ?? data.topMode ?? missingValue() },
    modeCount: { value: formatNumber(stats.modeCount ?? 0), tone: positiveTone(stats.modeCount) },
    unknownResults: { value: formatNumber(stats.unknownResults ?? 0), tone: positiveTone(stats.unknownResults, "warn") },
    firstRecord: { value: formatDate(stats.firstRecord) },
    lastRecord: { value: formatDate(stats.lastRecord) },
  }[key];
  return byKey ? { ...fallback, ...byKey } : fallback;
}

function shareStatLabel(key) {
  const labels = {
    playtime: t("overview.playtime"),
    reliableRecords: t("overview.reliable"),
    officialMatches: t("overview.officialMatches"),
    activityRecords: shareCopy("activityRecords"),
    wins: t("common.wins"),
    losses: t("common.losses"),
    selfKills: t("modes.selfKills"),
    selfDeaths: t("matches.deaths"),
    playerBedDestroys: shareCopy("playerBedDestroys"),
    currentWinStreak: t("overview.currentWinStreak"),
    playerMaxKillStreak: t("overview.playerKillStreak"),
    topServer: serverCopy("mainServer"),
    serverCount: shareCopy("serverCount"),
    topMode: uiCopy("topModeLabel"),
    modeCount: uiCopy("modeCountLabel"),
    unknownResults: t("common.unknown"),
    firstRecord: shareCopy("firstRecord"),
    lastRecord: shareCopy("lastRecord"),
  };
  return labels[key] ?? key;
}

function moveShareStatSlot(key, step) {
  const slots = normalizeShareStatSlots(state.shareStatSlots);
  const index = slots.indexOf(key);
  const target = index + Number(step);
  if (index < 0 || target < 0 || target >= slots.length) return;
  [slots[index], slots[target]] = [slots[target], slots[index]];
  storeShareStatSlots(slots);
}

function reorderShareStatSlot(key, targetIndex) {
  const slots = normalizeShareStatSlots(state.shareStatSlots);
  const index = slots.indexOf(key);
  if (index < 0) return false;
  const [slot] = slots.splice(index, 1);
  const insertionIndex = clamp(targetIndex, 0, slots.length);
  slots.splice(insertionIndex, 0, slot);
  if (slots.join("\u0000") === normalizeShareStatSlots(state.shareStatSlots).join("\u0000")) return false;
  storeShareStatSlots(slots);
  return true;
}

function removeShareStatSlot(key) {
  const slots = normalizeShareStatSlots(state.shareStatSlots).filter((slot) => slot !== key);
  storeShareStatSlots(slots);
}

function addShareStatSlot(key) {
  const slots = normalizeShareStatSlots(state.shareStatSlots);
  if (!key || slots.includes(key) || slots.length >= SHARE_STAT_SLOT_LIMIT) return;
  slots.push(key);
  storeShareStatSlots(slots);
}

function renderShareBar(data, kind, frame = state.shareFrame) {
  const normalizedKind = normalizeShareBarKind(kind);
  if (normalizedKind === "tape") return shareTapeBar(data, frame);
  const config = shareBarConfig(data, normalizedKind);
  return `
    <section class="share-info-bar ${escapeAttribute(normalizedKind)}">
      <div>
        <span>${escapeHtml(config.title)}</span>
        <strong>${escapeHtml(config.subtitle)}</strong>
      </div>
      <div class="share-info-bar-track" aria-label="${escapeAttribute(config.title)}">
        ${config.rows.length ? config.rows.map((row) => `<i style="width:${row.percent}%; background:${escapeAttribute(shareMixColor(row, data.theme))}" title="${escapeAttribute(`${row.label} / ${row.valueLabel}`)}"></i>`).join("") : `<em>${escapeHtml(config.emptyLabel)}</em>`}
      </div>
      <div class="share-info-legend">
        ${config.rows.map((row) => `<span><b style="background:${escapeAttribute(shareMixColor(row, data.theme))}"></b>${escapeHtml(row.label)} <strong>${escapeHtml(row.shareLabel)}</strong></span>`).join("")}
      </div>
    </section>
  `;
}

function shareTapeBar(data, frame = state.shareFrame) {
  const tape = data.tape.slice(0, shareTapeLimit(frame));
  const summary = shareTapeSummary(tape);
  return `
    <section class="share-info-bar tape">
      <div>
        <span>${escapeHtml(t("share.recentTape", { count: formatNumber(tape.length) }))}</span>
        <strong>${escapeHtml(shareCopy("tapeSummary", {
          wins: formatNumber(summary.wins),
          losses: formatNumber(summary.losses),
          unknown: formatNumber(summary.unknown),
          activity: formatNumber(summary.notApplicable),
        }))}</strong>
      </div>
      <div class="share-tape">${tape.length ? shareTapeCells(tape) : `<em>${escapeHtml(shareCopy("noTape"))}</em>`}</div>
    </section>
  `;
}

function shareTapeSummary(tape = []) {
  return tape.reduce((summary, round) => {
    const result = safeResult(round.result);
    if (result === "win") summary.wins += 1;
    else if (result === "loss") summary.losses += 1;
    else if (result === "not_applicable") summary.notApplicable += 1;
    else summary.unknown += 1;
    return summary;
  }, { wins: 0, losses: 0, unknown: 0, notApplicable: 0 });
}

function shareBarConfig(data, kind) {
  if (kind === "server") {
    return {
      title: shareCopy("serverMix"),
      subtitle: data.serverMetricLabel,
      rows: data.serverMix,
      emptyLabel: shareCopy("noServerMix"),
    };
  }
  if (kind === "result") {
    return {
      title: shareCopy("resultMix"),
      subtitle: shareCopy("resultMixRounds"),
      rows: data.resultMix,
      emptyLabel: shareCopy("noResultMix"),
    };
  }
  return {
    title: shareCopy("modeMix"),
    subtitle: data.modeMetricLabel,
    rows: data.modeMix,
    emptyLabel: shareCopy("noModeMix"),
  };
}

function shareMixColor(row, theme = state.theme) {
  return shareThemeName(theme) === "light" ? (row.lightColor ?? row.color) : row.color;
}

function previewStat(label, value, tone = "") {
  const resolvedTone = metricTone(value, tone);
  return `
    <div class="${escapeAttribute(resolvedTone)}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `;
}

function shareTapeCells(tape) {
  return tape.map((round) => `<i class="${escapeAttribute(round.result)}" title="${escapeAttribute(round.label)}"></i>`).join("");
}

function shareCopy(key, vars = {}) {
  const labels = {
    zh: {
      modeMetric: "\u5360\u6bd4\u53e3\u5f84",
      modeByRounds: "\u6309\u6570\u91cf",
      modeByPlaytime: "\u6309\u65f6\u957f",
      barSlots: "\u5361\u7247\u4fe1\u606f\u6761",
      barPrimary: "\u4e0a\u65b9",
      barSecondary: "\u4e0b\u65b9",
      statSlots: "\u5c0f\u6307\u6807",
      addStat: "\u6dfb\u52a0\u6307\u6807",
      chooseStat: "\u52a0\u5165\u5c0f\u6307\u6807",
      noMoreStats: "\u5df2\u6ca1\u6709\u53ef\u6dfb\u52a0\u7684\u6307\u6807",
      statEmpty: "\u6682\u65e0\u5c0f\u6307\u6807\uff0c\u53ef\u4ee5\u4ece\u53f3\u4e0a\u89d2\u6dfb\u52a0\u3002",
      statWideHint: "16:9 \u6700\u591a 6 \u9879\uff0c\u53ef\u968f\u6ce8\u6392\u5e8f",
      statSquareHint: "1:1 \u6700\u591a 4 \u9879",
      hiddenInSquare: "\u5728\u65b9\u56fe\u4e2d\u4ec5\u663e\u793a\u524d 4 \u9879",
      moveStatUp: "\u4e0a\u79fb {label}",
      moveStatDown: "\u4e0b\u79fb {label}",
      removeStat: "\u79fb\u9664 {label}",
      localDossier: "\u672c\u5730\u6218\u7ee9\u6863\u6848",
      yearRange: "{from}-{to}",
      sampleBadge: "{count} \u6761\u53ef\u9760\u8bb0\u5f55",
      winRateBadge: "{rate} \u80dc\u7387",
      modeMix: "\u6a21\u5f0f\u5360\u6bd4",
      serverMix: "\u670d\u52a1\u5668\u5206\u5e03",
      resultMix: "\u7ed3\u679c\u5206\u5e03",
      recentTapeBar: "\u6700\u8fd1\u5bf9\u5c40",
      activityRecords: "\u6d3b\u52a8\u8bb0\u5f55",
      modeMixRounds: "\u6309\u5c40\u6570\u8ba1",
      modeMixPlaytime: "\u6309\u65f6\u957f\u8ba1",
      serverMixRounds: "\u6309\u8bb0\u5f55\u6570\u8ba1",
      serverMixPlaytime: "\u6309\u6d3b\u8dc3\u65f6\u957f\u8ba1",
      resultMixRounds: "\u6309\u7ed3\u679c\u6570\u8ba1",
      resultMixPlaytime: "\u6309\u6d3b\u8dc3\u65f6\u957f\u8ba1",
      tapeSummary: "{wins} \u80dc / {losses} \u8d1f / {unknown} \u672a\u77e5 / {activity} \u6d3b\u52a8",
      playerBedDestroys: "\u672c\u4eba\u7834\u5e8a\u6570",
      serverCount: "\u670d\u52a1\u5668\u6570",
      firstRecord: "\u6700\u65e9\u8bb0\u5f55",
      lastRecord: "\u6700\u65b0\u8bb0\u5f55",
      noServerMix: "\u670d\u52a1\u5668\u6570\u636e\u4e0d\u8db3",
      noResultMix: "\u7ed3\u679c\u6570\u636e\u4e0d\u8db3",
      noTape: "\u6700\u8fd1\u5bf9\u5c40\u4e0d\u8db3",
      noModeMix: "\u6a21\u5f0f\u6570\u636e\u4e0d\u8db3",
      footerFull: "\u57fa\u4e8e {files} / {chatLines}",
    },
    en: {
      modeMetric: "Bar measure",
      modeByRounds: "By count",
      modeByPlaytime: "By playtime",
      barSlots: "Card bars",
      barPrimary: "Upper",
      barSecondary: "Lower",
      statSlots: "Small stats",
      addStat: "Add stat",
      chooseStat: "Add small stat",
      noMoreStats: "No more stats to add",
      statEmpty: "No small stats selected yet. Add one from the top-right.",
      statWideHint: "Up to 6 items in 16:9, reorder freely",
      statSquareHint: "Up to 4 items in 1:1",
      hiddenInSquare: "Only the first 4 show in square",
      moveStatUp: "Move {label} up",
      moveStatDown: "Move {label} down",
      removeStat: "Remove {label}",
      localDossier: "Local record dossier",
      yearRange: "{from}-{to}",
      sampleBadge: "{count} reliable records",
      winRateBadge: "{rate} win rate",
      modeMix: "Mode mix",
      serverMix: "Server mix",
      resultMix: "Result mix",
      recentTapeBar: "Recent tape",
      activityRecords: "Activity records",
      modeMixRounds: "By matches",
      modeMixPlaytime: "By playtime",
      serverMixRounds: "By records",
      serverMixPlaytime: "By active time",
      resultMixRounds: "By results",
      resultMixPlaytime: "By active time",
      tapeSummary: "{wins} W / {losses} L / {unknown} unknown / {activity} activity",
      playerBedDestroys: "Player bed destroys",
      serverCount: "Server count",
      firstRecord: "Earliest record",
      lastRecord: "Latest record",
      noServerMix: "Not enough server data",
      noResultMix: "Not enough result data",
      noTape: "Not enough recent matches",
      noModeMix: "Not enough mode data",
      footerFull: "Based on {files} / {chatLines}",
    },
  };
  const value = labels[state.locale === "en" ? "en" : "zh"][key] ?? key;
  return value.replace(/\{(\w+)\}/g, (_, name) => vars[name] ?? "");
}

function buildShareYearRange(view) {
  const first = yearFromDate(view.totals.firstPlayedDay);
  const last = yearFromDate(view.totals.lastPlayedDay);
  if (first && last && first !== last) return shareCopy("yearRange", { from: first, to: last });
  return first || last || shareCopy("localDossier");
}

function yearFromDate(value) {
  const date = safeDate(value);
  return date ? String(date.getFullYear()) : "";
}

function buildShareModeMix(modes = [], metric = "rounds") {
  const modeColors = ["#3db87a", "#5a9fd4", "#c4a23a", "#d95555", "#7c5fd6"];
  const rows = modes.slice(0, 5).map((mode, index) => {
    const value = metric === "playtime" ? Number(mode.durationSeconds ?? 0) : Number(mode.rounds ?? 0);
    return {
      label: mode.label ?? mode.id ?? t("common.unknown"),
      value: Number.isFinite(value) ? value : 0,
      color: modeColors[index % modeColors.length],
      valueLabel: metric === "playtime" ? formatDurationFromSeconds(value) : modeCountLabel(mode, value),
    };
  }).filter((mode) => mode.value > 0);
  const total = rows.reduce((sum, mode) => sum + mode.value, 0);
  if (!total) return [];
  return rows.map((mode, index) => {
    const share = mode.value / total;
    return {
      ...mode,
      lightColor: ["#5ea976", "#4f8fb7", "#b48f27", "#c8665d", "#8870c0"][index % 5],
      percent: Math.round(share * 1000) / 10,
      shareLabel: `${Math.round(share * 100)}%`,
    };
  });
}

function buildShareServerMix(serverRows = [], metric = "rounds") {
  const colors = ["#5a9fd4", "#3db87a", "#8870c0", "#c8665d", "#b48f27"];
  const rows = serverRows.slice(0, 5).map((server, index) => {
    const value = metric === "playtime" ? Number(server.durationSeconds ?? 0) : Number(server.records ?? 0);
    return {
      label: server.label ?? serverCopy("mainServer"),
      value: Number.isFinite(value) ? value : 0,
      color: colors[index % colors.length],
      lightColor: ["#4f8fb7", "#5ea976", "#8870c0", "#c8665d", "#b48f27"][index % 5],
      valueLabel: metric === "playtime" ? formatDurationFromSeconds(value) : serverCopy("records", { records: formatNumber(value) }),
    };
  }).filter((row) => row.value > 0);
  return shareMixRows(rows);
}

function buildShareResultMix(summary = {}) {
  const rows = [
    {
      label: t("common.wins"),
      value: Number(summary.wins ?? 0),
      color: "#3db87a",
      lightColor: "#5ea976",
      valueLabel: formatNumber(summary.wins ?? 0),
    },
    {
      label: t("common.losses"),
      value: Number(summary.losses ?? 0),
      color: "#d95555",
      lightColor: "#c8665d",
      valueLabel: formatNumber(summary.losses ?? 0),
    },
    {
      label: t("common.unknown"),
      value: Number(summary.unknown ?? 0),
      color: "#56616f",
      lightColor: "#9aa5a0",
      valueLabel: formatNumber(summary.unknown ?? 0),
    },
    {
      label: shareCopy("activityRecords"),
      value: Number(summary.notApplicable ?? 0),
      color: "#6f6954",
      lightColor: "#aaa180",
      valueLabel: formatNumber(summary.notApplicable ?? 0),
    },
  ].filter((row) => row.value > 0);
  return shareMixRows(rows);
}

function shareMixRows(rows = []) {
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  if (!total) return [];
  return rows.map((row) => {
    const share = row.value / total;
    return {
      ...row,
      percent: Math.round(share * 1000) / 10,
      shareLabel: `${Math.round(share * 100)}%`,
    };
  });
}

function normalizeShareBarKind(value) {
  return ["server", "mode", "result", "tape"].includes(value) ? value : "mode";
}

function shareBarPair(primary, secondary) {
  const first = normalizeShareBarKind(primary ?? state.sharePrimaryBar);
  let second = normalizeShareBarKind(secondary ?? state.shareSecondaryBar);
  if (first === second) {
    second = first === "server" ? "mode" : "server";
  }
  return [first, second];
}

function shareModeMix(data) {
  return renderShareBar(data, "mode");
}

function buildShareCardData(view, options = {}) {
  const kind = ["overview", "matches", "modes", "identity"].includes(options.kind ?? state.shareKind) ? (options.kind ?? state.shareKind) : "overview";
  const client = view.profile.preferences?.clientVersionByPlaytime;
  const modeMetric = (options.modeMetric ?? state.shareModeMetric) === "playtime" ? "playtime" : "rounds";
  const theme = shareThemeName(options.theme ?? state.theme);
  const shareBars = shareBarPair(options.primaryBar, options.secondaryBar);
  const rawScope = client?.scope ? displayScope(client.scope) : displayScope(view.sourceLabel);
  const rawSource = view.sources[0] ?? view.sourceLabel;
  const rawClientLabel = client?.scope ? displayScope(client.scope) : rawScope;
  const fileCount = formatNumber(view.overview.files);
  const chatLineCount = formatNumber(view.overview.chatLines);
  const files = t("share.files", { count: fileCount });
  const chatLines = t("share.chatLines", { count: chatLineCount });
  const wins = formatNumber(view.overview.wins);
  const losses = formatNumber(view.overview.losses);
  const reliableRounds = formatNumber(view.reliableRecordCount);
  const winRate = percent(view.overview.winRate);
  const yearRange = buildShareYearRange(view);
  const profile = shareKindProfile(kind, view, { modeMetric, reliableRounds, winRate, wins, losses, yearRange });
  const rounds = profile.rounds.slice(0, 48);
  const modeMetricLabel = modeMetric === "playtime" ? shareCopy("modeMixPlaytime") : shareCopy("modeMixRounds");
  const serverMetricLabel = modeMetric === "playtime" ? shareCopy("serverMixPlaytime") : shareCopy("serverMixRounds");
  const statSlots = normalizeShareStatSlots(options.statSlots ?? state.shareStatSlots);

  const data = {
    kind,
    theme,
    playerName: view.playerName,
    avatar: avatarModel(view),
    cardTitle: profile.title,
    cardSubtitle: profile.subtitle,
    generated: formatDate(view.summary.generatedAt),
    scope: rawScope,
    source: rawSource,
    files,
    fileCount,
    size: formatSize(view.overview.sizeMb),
    chatLines,
    chatLineCount,
    playtime: view.overview.playtime,
    reliableRounds,
    winRate,
    selfKd: formatRatio(view.overview.selfKills, view.overview.selfDeaths),
    selfKills: view.overview.selfKills,
    selfDeaths: view.overview.selfDeaths,
    wins,
    losses,
    winsLosses: t("share.winsLosses", { wins, losses }),
    peakStreak: formatNumber(view.streaks.selectedWin?.best?.count ?? 0),
    currentWinStreak: formatNumber(view.streaks.selectedWin?.current?.count ?? 0),
    playerMaxKillStreak: formatNumber(view.streaks.playerMaxKillStreak),
    knownResults: percent(view.overview.knownResultRate),
    activity: view.activity.duration,
    topMode: profile.topMode,
    clientLabel: rawClientLabel,
    badges: profile.badges,
    metrics: profile.metrics,
    svgMetrics: profile.svgMetrics,
    meta: profile.meta,
    includedItems: profile.includedItems,
    primaryMetricLabel: profile.primaryMetricLabel,
    primaryMetricValue: profile.primaryMetricValue,
    modeMetric,
    modeMetricLabel,
    serverMetricLabel,
    modeMix: profile.modeMix,
    serverMix: profile.serverMix,
    resultMix: profile.resultMix,
    resultSummary: profile.resultSummary,
    statContext: profile.statContext,
    statSlots,
    shareBars,
    yearRange,
    footerMeta: shareCopy("footerFull", { files, chatLines }),
    tape: rounds.map((round) => ({
      result: safeResult(round.result),
      label: `${formatDateTime(round.startAt)} / ${modeLabel(round.gameMode)} / ${roundServerLabel(round)} / ${resultLabel(round.result)} / ${round.duration ?? "0s"}`,
    })),
  };
  data.selectedStats = statSlots.map((key) => shareStatByKey(data, key)).filter(Boolean);
  return data;
}

function shareKindProfile(kind, view, context) {
  if (kind === "matches") return buildMatchesShareData(view, context);
  if (kind === "modes") return buildModesShareData(view, context);
  if (kind === "identity") return buildIdentityShareData(view, context);
  return buildOverviewShareData(view, context);
}

function buildOverviewShareData(view, { modeMetric, reliableRounds, winRate, wins, losses, yearRange }) {
  const modeMix = buildShareModeMix(view.topModes, modeMetric);
  const serverMix = buildShareServerMix(view.serverRows, modeMetric);
  const resultSummary = {
    wins: Number(view.overview.wins ?? 0),
    losses: Number(view.overview.losses ?? 0),
    unknown: Number(view.overview.unknownResults ?? 0),
    notApplicable: Number(view.activityRecordCount ?? 0),
  };
  const resultMix = buildShareResultMix(resultSummary);
  const topMode = view.topModes[0];
  const topServer = view.serverRows[0];
  const metricRows = [
    [t("overview.playtime"), view.overview.playtime],
    [t("overview.reliable"), reliableRounds],
    [t("common.winRate"), winRate, positiveTone(winRate)],
    ["K/D", formatRatio(view.overview.selfKills, view.overview.selfDeaths), positiveTone(view.overview.selfKills)],
    [t("overview.peakStreak"), formatNumber(view.streaks.selectedWin?.best?.count ?? 0), positiveTone(view.streaks.selectedWin?.best?.count ?? 0)],
    [t("overview.currentWinStreak"), formatNumber(view.streaks.selectedWin?.current?.count ?? 0), positiveTone(view.streaks.selectedWin?.current?.count ?? 0)],
    [t("overview.playerKillStreak"), formatNumber(view.streaks.playerMaxKillStreak), positiveTone(view.streaks.playerMaxKillStreak)],
    [serverCopy("mainServer"), topServer?.label ?? missingValue()],
  ];
  return {
    title: t("share.recordDossier"),
    subtitle: uiCopy("overviewSubtitle"),
    topMode: topMode?.label ?? topMode?.id ?? t("share.topModeFallback"),
    rounds: view.recentRounds,
    badges: [shareCopy("sampleBadge", { count: reliableRounds }), shareCopy("winRateBadge", { rate: winRate }), yearRange].filter(Boolean),
    metrics: metricRows.map(([label, value, tone]) => previewStat(label, value, tone)),
    svgMetrics: metricRows,
    meta: [[t("share.reliableRounds"), reliableRounds], [t("common.winRate"), winRate], [serverCopy("mainServer"), topServer?.label ?? missingValue()], [shareCopy("modeMix"), modeMetric === "playtime" ? shareCopy("modeMixPlaytime") : shareCopy("modeMixRounds")]],
    includedItems: [t("share.includedName"), t("common.winRate"), "K/D", t("share.includedWinLoss"), t("share.includedStreak"), serverCopy("serverMix"), t("share.includedTape"), shareCopy("modeMix")],
    primaryMetricLabel: t("share.reliableRounds"),
    primaryMetricValue: reliableRounds,
    modeMix,
    serverMix,
    resultMix,
    resultSummary,
    statContext: buildOverviewShareStatContext(view, { topServer, topMode }),
  };
}

function buildMatchesShareData(view, { modeMetric }) {
  const rows = filterRoundsByQuery(matchesSourceRows(), state.query);
  const rounds = rows.slice(0, 48);
  const summary = summarizeRounds(rows);
  const modeMix = buildShareModeMix(roundModes(rows), modeMetric);
  const serverRows = buildServerRows(rows);
  const serverMix = buildShareServerMix(serverRows, modeMetric);
  const resultSummary = {
    wins: summary.wins,
    losses: summary.losses,
    unknown: summary.unknown,
    notApplicable: summary.notApplicable,
  };
  const resultMix = buildShareResultMix(resultSummary);
  const topServer = serverRows[0];
  const filterLabel = activeFilterLabel();
  const metricRows = [
    [uiCopy("sample"), formatNumber(rows.length)],
    [t("common.wins"), formatNumber(summary.wins), positiveTone(summary.wins)],
    [t("common.losses"), formatNumber(summary.losses)],
    [t("common.winRate"), percent(summary.winRate), positiveTone(summary.winRate)],
    [t("matches.duration"), formatDurationFromSeconds(summary.durationSeconds)],
    ["K/D", formatRatio(summary.selfKills, summary.selfDeaths), positiveTone(summary.selfKills)],
    [t("common.unknown"), formatNumber(summary.unknown)],
    [serverCopy("mainServer"), topServer?.label ?? missingValue()],
  ];
  return {
    title: uiCopy("matchesShareTitle"),
    subtitle: filterLabel,
    topMode: topServer?.label ?? modeMix[0]?.label ?? t("share.topModeFallback"),
    rounds,
    badges: [uiCopy("filteredSample", { count: formatNumber(rows.length) }), filterLabel].filter(Boolean),
    metrics: metricRows.map(([label, value, tone]) => previewStat(label, value, tone)),
    svgMetrics: metricRows,
    meta: [[uiCopy("sample"), formatNumber(rows.length)], [t("common.winRate"), percent(summary.winRate)], [serverCopy("mainServer"), topServer?.label ?? missingValue()], [shareCopy("modeMix"), modeMetric === "playtime" ? shareCopy("modeMixPlaytime") : shareCopy("modeMixRounds")]],
    includedItems: [uiCopy("filters"), uiCopy("resultSplit"), serverCopy("serverMix"), shareCopy("modeMix"), t("share.includedTape"), "K/D"],
    primaryMetricLabel: uiCopy("sample"),
    primaryMetricValue: formatNumber(rows.length),
    modeMix,
    serverMix,
    resultMix,
    resultSummary,
    statContext: buildMatchesShareStatContext(rows, summary, { topServer, modeMix }),
  };
}

function buildModesShareData(view, { modeMetric }) {
  const modeMix = buildShareModeMix(view.modes, modeMetric);
  const serverMix = buildShareServerMix(view.serverRows, modeMetric);
  const resultSummary = summarizeModesForResults(view.modes);
  const resultMix = buildShareResultMix(resultSummary);
  const top = view.modes[0];
  const topServer = topServerForMode(top, view.serverRows);
  const topSelfKills = modeSelfKills(top);
  const topSelfDeaths = modeSelfDeaths(top);
  const metricRows = [
    [t("overview.officialMatches"), formatNumber(view.officialMatchCount)],
    [t("modes.duration"), view.overview.roundDuration ?? view.overview.playtime],
    [uiCopy("modeCountLabel"), formatNumber(view.modes.length), positiveTone(view.modes.length)],
    [uiCopy("topModeLabel"), top?.label ?? top?.id ?? t("common.unknown")],
    [t("common.winRate"), percent(top?.winRate ?? 0), positiveTone(top?.winRate ?? 0)],
    ["K/D", formatRatio(topSelfKills, topSelfDeaths), positiveTone(topSelfKills)],
    [t("modes.selfKills"), formatNumber(topSelfKills), positiveTone(topSelfKills)],
    [serverCopy("mainServer"), topServer?.label ?? missingValue()],
  ];
  return {
    title: uiCopy("modesShareTitle"),
    subtitle: modeMetric === "playtime" ? shareCopy("modeMixPlaytime") : shareCopy("modeMixRounds"),
    topMode: top?.label ?? top?.id ?? t("share.topModeFallback"),
    rounds: view.recentRounds,
    badges: [uiCopy("modeCount", { count: formatNumber(view.modes.length) }), uiCopy("topMode", { mode: top?.label ?? top?.id ?? t("common.unknown") }), shareCopy("modeMix")].filter(Boolean),
    metrics: metricRows.map(([label, value, tone]) => previewStat(label, value, tone)),
    svgMetrics: metricRows,
    meta: [[uiCopy("modeCountLabel"), formatNumber(view.modes.length)], [uiCopy("topModeLabel"), top?.label ?? top?.id ?? t("common.unknown")], [serverCopy("mainServer"), topServer?.label ?? missingValue()], [shareCopy("modeMix"), modeMetric === "playtime" ? shareCopy("modeMixPlaytime") : shareCopy("modeMixRounds")]],
    includedItems: [uiCopy("modeRank"), serverCopy("serverMix"), shareCopy("modeMix"), t("common.winRate"), "K/D", t("modes.duration")],
    primaryMetricLabel: uiCopy("modeCountLabel"),
    primaryMetricValue: formatNumber(view.modes.length),
    modeMix,
    serverMix,
    resultMix,
    resultSummary,
    statContext: buildModesShareStatContext(view, { top, topServer, topSelfKills, topSelfDeaths }),
  };
}

function buildIdentityShareData(view, { modeMetric }) {
  const rows = view.serverIdentityRows;
  const top = rows[0];
  const topServer = view.serverRows[0];
  const identityModes = rows.slice(0, 5).map((row) => ({
    id: row.name,
    label: row.name,
    rounds: row.rounds || row.evidence || 0,
    durationSeconds: row.durationSeconds || 0,
  }));
  const modeMix = buildShareModeMix(identityModes, modeMetric);
  const serverMix = buildShareServerMix(view.serverRows, modeMetric);
  const resultSummary = summarizeIdentityResults(rows);
  const resultMix = buildShareResultMix(resultSummary);
  const directHits = rows.reduce((sum, row) => sum + Number(row.direct ?? 0), 0);
  const metricRows = [
    [t("identity.matches"), formatNumber(view.serverIdentityRounds)],
    [t("identity.evidence"), formatNumber(view.serverIdentityEvidence), positiveTone(view.serverIdentityEvidence)],
    [t("identity.direct"), formatNumber(directHits), positiveTone(directHits)],
    [uiCopy("identityCountLabel"), formatNumber(rows.length), positiveTone(rows.length)],
    [t("overview.firstSeen"), formatDate(top?.firstSeenAt)],
    [t("overview.lastSeen"), formatDate(top?.lastSeenAt)],
    [uiCopy("topName"), top?.name ?? t("common.unknown")],
    [serverCopy("mainServer"), topServer?.label ?? missingValue()],
  ];
  return {
    title: uiCopy("identityShareTitle"),
    subtitle: uiCopy("identitySubtitle", { count: formatNumber(rows.length) }),
    topMode: top?.name ?? t("common.unknown"),
    rounds: view.recentRounds.filter((round) => Object.keys(round.serverPlayerIds ?? {}).length).slice(0, 48),
    badges: [uiCopy("identityCount", { count: formatNumber(rows.length) }), uiCopy("evidenceCount", { count: formatNumber(view.serverIdentityEvidence) })].filter(Boolean),
    metrics: metricRows.map(([label, value, tone]) => previewStat(label, value, tone)),
    svgMetrics: metricRows,
    meta: [[uiCopy("identityCountLabel"), formatNumber(rows.length)], [t("identity.evidence"), formatNumber(view.serverIdentityEvidence)], [uiCopy("topName"), top?.name ?? t("common.unknown")], [serverCopy("mainServer"), topServer?.label ?? missingValue()]],
    includedItems: [uiCopy("identityRank"), t("identity.evidence"), t("identity.direct"), serverCopy("serverMix"), t("overview.firstSeen"), t("overview.lastSeen")],
    primaryMetricLabel: uiCopy("identityCountLabel"),
    primaryMetricValue: formatNumber(rows.length),
    modeMix,
    serverMix,
    resultMix,
    resultSummary,
    statContext: buildIdentityShareStatContext(view, { rows, top, topServer, directHits }),
  };
}

function buildOverviewShareStatContext(view, { topServer, topMode } = {}) {
  return {
    officialMatches: view.officialMatchCount,
    activityRecords: view.activityRecordCount,
    selfKills: view.overview.selfKills,
    selfDeaths: view.overview.selfDeaths,
    playerBedDestroys: view.overview.playerBedDestroys ?? view.overview.selfBedDestroys ?? 0,
    serverCount: view.serverRows.length,
    modeCount: view.modes.length,
    unknownResults: view.overview.unknownResults,
    firstRecord: view.totals.firstPlayedDay,
    lastRecord: view.totals.lastPlayedDay,
    topServer,
    topMode,
  };
}

function buildMatchesShareStatContext(rows, summary, { topServer, modeMix } = {}) {
  const modes = roundModes(rows);
  return {
    officialMatches: summary.wins + summary.losses + summary.unknown,
    activityRecords: summary.notApplicable,
    selfKills: summary.selfKills,
    selfDeaths: summary.selfDeaths,
    playerBedDestroys: rows.reduce((sum, round) => sum + playerBedDestroys(round), 0),
    serverCount: buildServerRows(rows).length,
    modeCount: modes.length,
    unknownResults: summary.unknown,
    firstRecord: earliestRoundDate(rows),
    lastRecord: latestRoundDate(rows),
    topServer,
    topMode: modes[0] ?? (modeMix?.[0] ? { label: modeMix[0].label } : null),
  };
}

function buildModesShareStatContext(view, { top, topServer, topSelfKills, topSelfDeaths } = {}) {
  return {
    officialMatches: view.officialMatchCount,
    activityRecords: view.activityRecordCount,
    selfKills: topSelfKills,
    selfDeaths: topSelfDeaths,
    playerBedDestroys: Number(top?.playerBedDestroys ?? top?.selfBedDestroys ?? 0),
    serverCount: view.serverRows.length,
    modeCount: view.modes.length,
    unknownResults: view.modes.reduce((sum, mode) => sum + Number(mode.unknownResults ?? 0), 0),
    firstRecord: view.totals.firstPlayedDay,
    lastRecord: view.totals.lastPlayedDay,
    topServer,
    topMode: top,
  };
}

function buildIdentityShareStatContext(view, { rows, top, topServer, directHits } = {}) {
  return {
    officialMatches: view.serverIdentityRounds,
    activityRecords: view.activityRecordCount,
    selfKills: view.overview.selfKills,
    selfDeaths: view.overview.selfDeaths,
    playerBedDestroys: view.overview.playerBedDestroys ?? view.overview.selfBedDestroys ?? 0,
    serverCount: view.serverRows.length,
    modeCount: rows.length,
    unknownResults: view.overview.unknownResults,
    firstRecord: top?.firstSeenAt ?? view.totals.firstPlayedDay,
    lastRecord: top?.lastSeenAt ?? view.totals.lastPlayedDay,
    topServer,
    topMode: top ? { label: top.name } : null,
    directHits,
  };
}

function earliestRoundDate(rows = []) {
  return rows.reduce((earliest, round) => earlierDate(earliest, round.startAt), null);
}

function latestRoundDate(rows = []) {
  return rows.reduce((latest, round) => laterDate(latest, round.endAt ?? round.startAt), null);
}

function summarizeRounds(rounds = []) {
  const summary = {
    wins: 0,
    losses: 0,
    unknown: 0,
    notApplicable: 0,
    durationSeconds: 0,
    selfKills: 0,
    selfDeaths: 0,
  };
  for (const round of rounds) {
    if (round.result === "win") summary.wins += 1;
    else if (round.result === "loss") summary.losses += 1;
    else if (round.result === "not_applicable" || round.resultEligible === false) summary.notApplicable += 1;
    else summary.unknown += 1;
    summary.durationSeconds += Number(round.durationSeconds ?? 0);
    summary.selfKills += playerSelfKills(round);
    summary.selfDeaths += playerSelfDeaths(round);
  }
  const known = summary.wins + summary.losses;
  summary.winRate = known ? summary.wins / known : 0;
  return summary;
}

function summarizeModesForResults(modes = []) {
  return modes.reduce((summary, mode) => {
    summary.wins += Number(mode.wins ?? 0);
    summary.losses += Number(mode.losses ?? 0);
    summary.unknown += Number(mode.unknownResults ?? mode.unknown ?? 0);
    summary.notApplicable += Number(mode.notApplicableResults ?? mode.not_applicable_results ?? 0);
    return summary;
  }, { wins: 0, losses: 0, unknown: 0, notApplicable: 0 });
}

function summarizeIdentityResults(rows = []) {
  return rows.reduce((summary, row) => {
    summary.wins += Number(row.wins ?? 0);
    summary.losses += Number(row.losses ?? 0);
    summary.unknown += Number(row.unknown ?? 0);
    summary.notApplicable += Number(row.segments ?? 0);
    return summary;
  }, { wins: 0, losses: 0, unknown: 0, notApplicable: 0 });
}

function roundModes(rounds = []) {
  const modes = new Map();
  for (const round of rounds) {
    const id = round.gameMode || "unknown";
    const row = getGroup(modes, id, () => ({
      id,
      label: modeLabel(id),
      rounds: 0,
      durationSeconds: 0,
      selfKills: 0,
      selfDeaths: 0,
      wins: 0,
      losses: 0,
    }));
    row.rounds += 1;
    row.durationSeconds += Number(round.durationSeconds ?? 0);
    row.selfKills += playerSelfKills(round);
    row.selfDeaths += playerSelfDeaths(round);
    if (round.result === "win") row.wins += 1;
    if (round.result === "loss") row.losses += 1;
  }
  return [...modes.values()].map((row) => ({
    ...row,
    duration: formatDurationFromSeconds(row.durationSeconds),
    winRate: row.wins + row.losses ? row.wins / (row.wins + row.losses) : 0,
  })).sort((a, b) => b.rounds - a.rounds || b.durationSeconds - a.durationSeconds);
}

function activeFilterLabel() {
  const parts = [];
  if (state.filters.result) parts.push(resultLabel(state.filters.result));
  if (state.filters.mode) parts.push(modeLabel(state.filters.mode));
  if (state.filters.source) parts.push(displayScope(state.filters.source));
  if (state.query.trim()) parts.push(`"${state.query.trim()}"`);
  return parts.length ? parts.join(" / ") : t("common.all");
}

function uiCopy(key, vars = {}) {
  const labels = {
    zh: {
      cards: "\u5361\u7247",
      list: "\u5217\u8868",
      viewMode: "\u5c55\u793a\u6a21\u5f0f",
      matchSort: "\u5bf9\u5c40\u6392\u5e8f",
      newest: "\u6700\u65b0",
      oldest: "\u6700\u8001",
      pagination: "\u5206\u9875",
      previous: "\u4e0a\u4e00\u9875",
      next: "\u4e0b\u4e00\u9875",
      pageOf: "\u7b2c {page} / {pages} \u9875",
      showingPage: "\u7b2c {page} / {pages} \u9875",
      totalItems: "\u5171 {count} \u9879",
      viewDetail: "\u8fdb\u5165\u8be6\u60c5",
      collapseDetail: "\u6536\u8d77\u8be6\u60c5",
      heatPager: "\u70ed\u529b\u56fe\u7a97\u53e3",
      olderHeat: "\u67e5\u770b\u66f4\u65e9\u7684 13 \u5468",
      newerHeat: "\u67e5\u770b\u66f4\u65b0\u7684 13 \u5468",
      earliestHeat: "\u8df3\u5230\u6700\u65e9\u7684\u70ed\u529b\u56fe",
      latestHeat: "\u56de\u5230\u6700\u65b0\u70ed\u529b\u56fe",
      earliest: "\u6700\u65e9",
      older: "\u66f4\u65e9",
      newer: "\u66f4\u65b0",
      shareKind: "\u5361\u7247\u7c7b\u578b",
      shareOverview: "\u603b\u89c8\u6218\u7ee9",
      shareMatches: "\u5bf9\u5c40\u4e0a\u4e0b\u6587",
      shareModes: "\u6a21\u5f0f\u5206\u5e03",
      shareIdentity: "\u5c40\u5185\u540d\u79f0",
      overviewSubtitle: "\u672c\u5730\u6218\u7ee9\u603b\u89c8",
      matchesShareTitle: "\u5bf9\u5c40\u5206\u4eab\u5361",
      modesShareTitle: "\u6a21\u5f0f\u5206\u4eab\u5361",
      identityShareTitle: "\u8eab\u4efd\u5206\u4eab\u5361",
      filteredSample: "{count} \u6761\u5f53\u524d\u7ed3\u679c",
      currentContext: "\u5f53\u524d\u4e0a\u4e0b\u6587",
      sample: "\u6837\u672c",
      filters: "\u7b5b\u9009",
      resultSplit: "\u7ed3\u679c\u5206\u5e03",
      modeCount: "{count} \u79cd\u6a21\u5f0f",
      modeCountLabel: "\u6a21\u5f0f\u6570",
      topMode: "\u9996\u4f4d {mode}",
      topModeLabel: "\u9996\u4f4d\u6a21\u5f0f",
      modeRank: "\u6a21\u5f0f\u6392\u884c",
      identitySubtitle: "{count} \u4e2a\u5c40\u5185\u540d\u79f0",
      identityCount: "{count} \u4e2a\u540d\u79f0",
      evidenceCount: "{count} \u6761\u8bc1\u636e",
      identityCountLabel: "\u540d\u79f0\u6570",
      identityRank: "\u540d\u79f0\u6392\u884c",
      topName: "\u4e3b\u8981\u540d\u79f0",
    },
    en: {
      cards: "Cards",
      list: "List",
      viewMode: "View mode",
      matchSort: "Match sort",
      newest: "Newest",
      oldest: "Oldest",
      pagination: "Pagination",
      previous: "Previous",
      next: "Next",
      pageOf: "Page {page} / {pages}",
      showingPage: "Page {page} / {pages}",
      totalItems: "{count} total",
      viewDetail: "Open detail",
      collapseDetail: "Hide details",
      heatPager: "Heatmap window",
      olderHeat: "Show the previous 13 weeks",
      newerHeat: "Show the next 13 weeks",
      earliestHeat: "Jump to the earliest heatmap",
      latestHeat: "Return to the latest heatmap",
      earliest: "Earliest",
      older: "Older",
      newer: "Newer",
      shareKind: "Card type",
      shareOverview: "Overview record",
      shareMatches: "Match context",
      shareModes: "Mode mix",
      shareIdentity: "In-game names",
      overviewSubtitle: "Local record overview",
      matchesShareTitle: "Match share card",
      modesShareTitle: "Mode share card",
      identityShareTitle: "Identity share card",
      filteredSample: "{count} current records",
      currentContext: "Current context",
      sample: "Sample",
      filters: "Filters",
      resultSplit: "Result split",
      modeCount: "{count} modes",
      modeCountLabel: "Modes",
      topMode: "Top {mode}",
      topModeLabel: "Top mode",
      modeRank: "Mode ranking",
      identitySubtitle: "{count} in-game names",
      identityCount: "{count} names",
      evidenceCount: "{count} evidence hits",
      identityCountLabel: "Names",
      identityRank: "Name ranking",
      topName: "Primary name",
    },
  };
  const value = labels[state.locale === "en" ? "en" : "zh"][key] ?? key;
  return value.replace(/\{(\w+)\}/g, (_, name) => vars[name] ?? "");
}

function auditCopy(key, vars = {}) {
  const labels = {
    zh: {
      oobeEyebrow: "审计工作台",
      oobeTitle: "先复核 Unknown，再让规则进入干跑",
      oobeSummary: "这里只做本地人工标注和规则预览。标注不会直接改战绩，规则也会先做 dry-run，确认风险后再由你决定是否保存启用。",
      oobeStepQueue: "筛选队列",
      oobeStepQueueDetail: "当前 {count} 条待复核记录",
      oobeStepLabel: "人工标注",
      oobeStepLabelDetail: "把 unknown 标成胜利、失败、忽略或继续保留",
      oobeStepRules: "规则 dry-run",
      oobeStepRulesDetail: "已读取 {count} 个规则包",
      dismissOobe: "收起审计引导",
      flowTitle: "处理顺序",
      flowSubtitle: "从待复核队列到本地规则预览",
      flowQueue: "队列",
      flowQueueHint: "选择筛选条件",
      flowLabel: "标注",
      flowLabelHint: "写人工结论",
      flowDryRun: "Dry-run",
      flowDryRunHint: "验证影响",
      flowRules: "规则",
      flowRulesHint: "保存前检查",
      unknownQueue: "Unknown 队列",
      unknownQueueHint: "需要人工确认的结果",
      knownCoverage: "已识别覆盖",
      knownCoverageHint: "官方胜负已识别比例",
      reviewRows: "当前筛选",
      reviewRowsHint: "可标注 unknown 条目",
      priority: "优先级",
      category: "分类",
      nextAction: "下一步",
      mode: "模式",
      allModes: "全部模式",
      allPriorities: "全部优先级",
      allCategories: "全部分类",
      allActions: "全部动作",
      refreshAuditData: "刷新审计数据",
      noUnknownRows: "当前筛选下没有 unknown 队列。",
      unknown: "未知",
      noCategory: "未分类",
      selectUnknown: "选择一条 unknown 记录开始标注。",
      reviewDetail: "标注详情",
      resultHint: "结果提示",
      serverConfidence: "服务器置信度",
      ownerTeamKnown: "队伍已知",
      selfAction: "本人动作",
      endReason: "结束原因",
      evidenceKinds: "证据类型",
      none: "无",
      reviewLabel: "标注结果",
      reviewNotes: "标注备注",
      notesPlaceholder: "写下为什么这样标注",
      exactMessage: "精确聊天原文",
      messagePlaceholder: "生成规则时最好提供原文",
      ruleId: "规则 ID",
      confidence: "置信度",
      unset: "未设置",
      labelWorkflow: "验证与规则预览",
      checkStatus: "检查状态",
      validateLabels: "验证标注",
      runWorkflow: "生成规则预览",
      statusResult: "状态检查",
      validationResult: "标注验证",
      workflowResult: "工作流预览",
      status: "状态",
      nextStep: "下一步",
      blockingReason: "阻塞原因",
      readyForWorkflow: "可继续",
      draftRules: "草稿规则",
      rulePacks: "规则包",
      userRulePacks: "用户规则包",
      noRulePacks: "没有规则包信息。",
      noUserRulePacks: "还没有用户规则包。",
      noUserRulePacksHint: "用下方 JSON 保存一个用户规则包后，就能在这里启用、停用、载入、备份或删除。",
      userRulePackManager: "用户规则包管理",
      userRulePackManagerHint: "这里只管理 custom-rules/user 里的项目规则包。启用或停用后，需要刷新报告才会影响统计。",
      managedRulePackEditorHint: "编辑、校验并 dry-run 一个用户规则包；确认后保存到本地项目目录。",
      bundledRulePacks: "内置规则包",
      bundledRulePacksHint: "这些来自应用或配置，只作为当前加载状态参考，不能在这里启用或停用。",
      manageablePacks: "可管理",
      readOnly: "只读",
      unknownRulePack: "未知规则包",
      enabled: "启用",
      disabled: "停用",
      valid: "有效",
      invalid: "无效",
      rules: "规则",
      ruleDiagnostics: "规则诊断",
      selectedRules: "已选择规则包",
      eventTypes: "事件类型",
      auditEvents: "操作记录",
      noRuleWarnings: "没有规则诊断警告。",
      statusUpdated: "审计状态已更新。",
      statusFailed: "状态检查失败。",
      validationUpdated: "标注验证已完成。",
      validationFailed: "标注验证失败。",
      workflowUpdated: "规则预览已生成。",
      workflowFailed: "规则预览失败。",
      refreshed: "审计数据已刷新。",
      labelSaved: "标注已暂存。",
      keepUnknown: "保持未知",
      newRuleNeeded: "需要新规则",
      ruleTestLab: "规则测试",
      noWrites: "不写入",
      chatMessage: "聊天原文",
      chatMessagePlaceholder: "粘贴一条聊天原文，用现有规则测试或生成草稿",
      ruleType: "规则类型",
      targetMode: "目标模式",
      testCurrentRules: "测试现有规则",
      draftRule: "生成草稿",
      ruleTestResult: "测试结果",
      ruleDraftResult: "草稿规则",
      matched: "命中",
      inferredMode: "推断模式",
      managedRulePackEditor: "用户规则包 JSON",
      validateRulePack: "校验 JSON",
      dryRunRulePack: "Dry-run 预览",
      saveUserRulePack: "保存到用户规则包",
      dryRunResult: "Dry-run 结果",
      roundChanges: "对局变更",
      risks: "风险",
      saveResult: "保存结果",
      backup: "备份",
      loadedRulePack: "已载入规则包",
      backups: "备份",
      noBackups: "没有可恢复的备份。",
      restoreBackup: "恢复",
      loadRulePack: "载入",
      enableRulePack: "启用",
      disableRulePack: "停用",
      showBackups: "备份",
      deleteRulePack: "删除",
      confirmDeleteRulePack: "确定删除用户规则包 {id}？",
      messageRequired: "请先填写聊天原文。",
      invalidJson: "规则包 JSON 格式错误。",
      ruleTested: "规则测试完成。",
      ruleTestFailed: "规则测试失败。",
      ruleDrafted: "草稿已生成。",
      ruleDraftFailed: "草稿生成失败。",
      rulePackValidated: "规则包校验完成。",
      rulePackValidationFailed: "规则包校验失败。",
      rulePackDryRunDone: "Dry-run 完成。",
      rulePackDryRunFailed: "Dry-run 失败。",
      rulePackSaved: "用户规则包已保存。",
      rulePackSaveFailed: "用户规则包保存失败。",
      rulePackLoaded: "规则包已载入。",
      rulePackLoadFailed: "规则包载入失败。",
      rulePackEnabled: "规则包已启用，刷新后影响统计。",
      rulePackDisabled: "规则包已停用，刷新后影响统计。",
      rulePackToggleFailed: "规则包启停失败。",
      ruleBackupsLoaded: "备份列表已载入。",
      ruleBackupsFailed: "备份列表载入失败。",
      ruleBackupRestored: "备份已恢复。",
      ruleBackupRestoreFailed: "备份恢复失败。",
      rulePackDeleted: "用户规则包已删除。",
      rulePackDeleteFailed: "用户规则包删除失败。",
    },
    en: {
      oobeEyebrow: "Audit workbench",
      oobeTitle: "Review unknown results before rules touch your stats",
      oobeSummary: "This page stages local human labels and rule previews only. Labels do not change your record directly; rules go through dry-run first so you can inspect impact before saving or enabling anything.",
      oobeStepQueue: "Filter the queue",
      oobeStepQueueDetail: "{count} review rows in the current queue",
      oobeStepLabel: "Label unknowns",
      oobeStepLabelDetail: "Mark win, loss, ignore, keep unknown, or new rule needed",
      oobeStepRules: "Dry-run rules",
      oobeStepRulesDetail: "{count} rule packs loaded",
      dismissOobe: "Dismiss audit guide",
      flowTitle: "Workflow",
      flowSubtitle: "From review queue to local rule preview",
      flowQueue: "Queue",
      flowQueueHint: "Choose filters",
      flowLabel: "Label",
      flowLabelHint: "Stage decisions",
      flowDryRun: "Dry-run",
      flowDryRunHint: "Check impact",
      flowRules: "Rules",
      flowRulesHint: "Save after review",
      unknownQueue: "Unknown queue",
      unknownQueueHint: "Results needing human review",
      knownCoverage: "Known coverage",
      knownCoverageHint: "Official result recognition rate",
      reviewRows: "Current filter",
      reviewRowsHint: "Labelable unknown rows",
      priority: "Priority",
      category: "Category",
      nextAction: "Next action",
      mode: "Mode",
      allModes: "All modes",
      allPriorities: "All priorities",
      allCategories: "All categories",
      allActions: "All actions",
      refreshAuditData: "Refresh audit data",
      noUnknownRows: "No unknown rows for the current filters.",
      unknown: "Unknown",
      noCategory: "Uncategorized",
      selectUnknown: "Select an unknown row to start labeling.",
      reviewDetail: "Review detail",
      resultHint: "Result hint",
      serverConfidence: "Server confidence",
      ownerTeamKnown: "Team known",
      selfAction: "Self action",
      endReason: "End reason",
      evidenceKinds: "Evidence kinds",
      none: "None",
      reviewLabel: "Review label",
      reviewNotes: "Review notes",
      notesPlaceholder: "Explain why this label fits",
      exactMessage: "Exact chat message",
      messagePlaceholder: "Best supplied before generating a rule",
      ruleId: "Rule ID",
      confidence: "Confidence",
      unset: "Unset",
      labelWorkflow: "Validation and rule preview",
      checkStatus: "Check status",
      validateLabels: "Validate labels",
      runWorkflow: "Generate rule preview",
      statusResult: "Status check",
      validationResult: "Label validation",
      workflowResult: "Workflow preview",
      status: "Status",
      nextStep: "Next step",
      blockingReason: "Blocking reason",
      readyForWorkflow: "Ready",
      draftRules: "Draft rules",
      rulePacks: "Rule packs",
      userRulePacks: "User rule packs",
      noRulePacks: "No rule pack information.",
      noUserRulePacks: "No user rule packs yet.",
      noUserRulePacksHint: "Save a user rule pack from the JSON editor below, then it will appear here with enable, disable, load, backup, and delete actions.",
      userRulePackManager: "User rule pack manager",
      userRulePackManagerHint: "Only project-managed packs in custom-rules/user can be managed here. Refresh the report before enable changes affect statistics.",
      managedRulePackEditorHint: "Edit, validate, and dry-run a user rule pack before saving it to the local project.",
      bundledRulePacks: "Built-in rule packs",
      bundledRulePacksHint: "These come from the app or configured paths. They are read-only in this panel.",
      manageablePacks: "manageable",
      readOnly: "Read-only",
      unknownRulePack: "Unknown rule pack",
      enabled: "Enabled",
      disabled: "Disabled",
      valid: "Valid",
      invalid: "Invalid",
      rules: "rules",
      ruleDiagnostics: "Rule diagnostics",
      selectedRules: "Selected packs",
      eventTypes: "Event types",
      auditEvents: "Audit events",
      noRuleWarnings: "No rule diagnostic warnings.",
      statusUpdated: "Audit status updated.",
      statusFailed: "Status check failed.",
      validationUpdated: "Labels validated.",
      validationFailed: "Label validation failed.",
      workflowUpdated: "Rule preview generated.",
      workflowFailed: "Rule preview failed.",
      refreshed: "Audit data refreshed.",
      labelSaved: "Label staged.",
      keepUnknown: "Keep unknown",
      newRuleNeeded: "New rule needed",
      ruleTestLab: "Rule test lab",
      noWrites: "No writes",
      chatMessage: "Chat message",
      chatMessagePlaceholder: "Paste one exact chat line to test current rules or draft a candidate",
      ruleType: "Rule type",
      targetMode: "Target mode",
      testCurrentRules: "Test current rules",
      draftRule: "Draft rule",
      ruleTestResult: "Test result",
      ruleDraftResult: "Draft rule",
      matched: "Matched",
      inferredMode: "Inferred mode",
      managedRulePackEditor: "User rule pack JSON",
      validateRulePack: "Validate JSON",
      dryRunRulePack: "Dry-run preview",
      saveUserRulePack: "Save user pack",
      dryRunResult: "Dry-run result",
      roundChanges: "Round changes",
      risks: "Risks",
      saveResult: "Save result",
      backup: "Backup",
      loadedRulePack: "Loaded rule pack",
      backups: "Backups",
      noBackups: "No backups available.",
      restoreBackup: "Restore",
      loadRulePack: "Load",
      enableRulePack: "Enable",
      disableRulePack: "Disable",
      showBackups: "Backups",
      deleteRulePack: "Delete",
      confirmDeleteRulePack: "Delete user rule pack {id}?",
      messageRequired: "Enter a chat message first.",
      invalidJson: "Rule pack JSON is invalid.",
      ruleTested: "Rule test completed.",
      ruleTestFailed: "Rule test failed.",
      ruleDrafted: "Draft generated.",
      ruleDraftFailed: "Draft generation failed.",
      rulePackValidated: "Rule pack validated.",
      rulePackValidationFailed: "Rule pack validation failed.",
      rulePackDryRunDone: "Dry-run completed.",
      rulePackDryRunFailed: "Dry-run failed.",
      rulePackSaved: "User rule pack saved.",
      rulePackSaveFailed: "User rule pack save failed.",
      rulePackLoaded: "Rule pack loaded.",
      rulePackLoadFailed: "Rule pack load failed.",
      rulePackEnabled: "Rule pack enabled. Refresh before statistics change.",
      rulePackDisabled: "Rule pack disabled. Refresh before statistics change.",
      rulePackToggleFailed: "Rule pack enable state failed.",
      ruleBackupsLoaded: "Backups loaded.",
      ruleBackupsFailed: "Backups failed.",
      ruleBackupRestored: "Backup restored.",
      ruleBackupRestoreFailed: "Backup restore failed.",
      rulePackDeleted: "User rule pack deleted.",
      rulePackDeleteFailed: "User rule pack delete failed.",
    },
  };
  const value = labels[state.locale === "en" ? "en" : "zh"][key] ?? key;
  return value.replace(/\{(\w+)\}/g, (_, name) => vars[name] ?? "");
}

function auditLabel(value) {
  const labels = {
    "keep-unknown": auditCopy("keepUnknown"),
    "new-rule-needed": auditCopy("newRuleNeeded"),
    high: state.locale === "en" ? "High" : "高",
    medium: state.locale === "en" ? "Medium" : "中",
    low: state.locale === "en" ? "Low" : "低",
    win: resultLabel("win"),
    loss: resultLabel("loss"),
    round_end: state.locale === "en" ? "Round end" : "对局结束",
    boundary: state.locale === "en" ? "Boundary" : "边界",
    diagnostic: state.locale === "en" ? "Diagnostic" : "诊断",
    ignore: state.locale === "en" ? "Ignore" : "忽略",
  };
  return labels[value] ?? String(value ?? auditCopy("unknown"));
}

function auditReviewLabel(value) {
  return auditLabel(value);
}

function updateRuleField(name, value) {
  if (name === "message") state.auditRuleMessage = value;
  if (name === "type") state.auditRuleType = value || "round_end";
  if (name === "mode") state.auditRuleMode = value || "bedwars";
  if (name === "packJson") state.auditRulePackJson = value;
  resetRuleToolOutputs();
}

function bindInteractions() {
  unbindInteractions();
  interactionController = new AbortController();
  const listenerOptions = { signal: interactionController.signal };

  root.querySelectorAll("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeTab = button.dataset.tab;
      state.activeRoundDetail = null;
      state.roundDetailReturnTab = "matches";
      state.roundDebugOpenKey = "";
      if (state.activeTab !== "matches") state.filterPanelOpen = false;
      if (state.activeTab !== "share") state.shareKind = shareKindForTab(state.activeTab);
      const nextTab = state.activeTab;
      renderFrame();
      if (nextTab === "matches" && !state.query.trim()) {
        refreshRounds()
          .then(() => {
            if (state.activeTab === nextTab && !state.activeRoundDetail) renderMainRegion();
          })
          .catch((error) => showToast(error.message || t("refresh.failed"), "error"));
      }
      if (nextTab === "audit" && !state.auditRounds?.items) {
        refreshAuditData()
          .then(() => {
            if (state.activeTab === nextTab && !state.activeRoundDetail) renderMainRegion();
          })
          .catch((error) => showToast(error.message || auditCopy("refreshed"), "error"));
      }
    }, listenerOptions);
  });

  root.querySelector("[data-query]")?.addEventListener("input", async (event) => {
    const cursor = event.target.selectionStart ?? event.target.value.length;
    state.query = event.target.value;
    state.matchesPage = 0;
    state.expandedRoundKey = "";
    state.activeRoundDetail = null;
    state.roundDetailReturnTab = "matches";
    state.roundDebugOpenKey = "";
    if (state.activeTab === "matches") {
      if (state.query.trim() && !state.roundSearchCache) await ensureRoundContextCache();
      if (!state.query.trim()) await refreshRounds();
      else renderMainRegion();
      const nextInput = root.querySelector("[data-query]");
      nextInput?.focus({ preventScroll: true });
      nextInput?.setSelectionRange(cursor, cursor);
    }
  }, listenerOptions);

  root.querySelectorAll("[data-filter]").forEach((element) => {
    element.addEventListener("change", async (event) => {
      state.filters[event.target.dataset.filter] = event.target.value;
      state.activeRoundDetail = null;
      state.roundDetailReturnTab = "matches";
      state.roundDebugOpenKey = "";
      resetRoundPaging();
      await refreshRounds();
    }, listenerOptions);
  });

  root.querySelectorAll("[data-result-filter]").forEach((button) => {
    button.addEventListener("click", async () => {
      state.filters.result = button.dataset.resultFilter;
      state.activeRoundDetail = null;
      state.roundDetailReturnTab = "matches";
      state.roundDebugOpenKey = "";
      resetRoundPaging();
      await refreshRounds();
    }, listenerOptions);
  });

  root.querySelectorAll("[data-action='open-share']").forEach((button) => {
    button.addEventListener("click", () => {
      state.shareKind = normalizeShareKind(button.dataset.shareKindTarget || shareKindForTab(state.activeTab));
      state.activeTab = "share";
      state.filterPanelOpen = false;
      const needsMatchContext = state.shareKind === "matches" && (state.query.trim() || state.filters.mode || state.filters.result || state.filters.source);
      renderFrame();
      if (needsMatchContext) {
        ensureRoundContextCache()
          .then(() => {
            if (state.activeTab === "share" && state.shareKind === "matches") renderMainRegion();
          })
          .catch((error) => showToast(error.message || t("refresh.failed"), "error"));
      }
    }, listenerOptions);
  });

  root.querySelectorAll("[data-action='open-profile-editor']").forEach((button) => {
    button.addEventListener("click", () => {
      state.profileEditorOpen = true;
      state.profileAliasOpen = false;
      state.profileDraftName = buildViewModel().playerName ?? "";
      render();
    }, listenerOptions);
  });

  root.querySelectorAll("[data-action='close-profile-editor']").forEach((button) => {
    button.addEventListener("click", () => {
      state.profileEditorOpen = false;
      state.profileAliasOpen = false;
      state.profileDraftName = null;
      render();
    }, listenerOptions);
  });

  root.querySelector("[data-profile-editor]")?.addEventListener("click", (event) => {
    event.stopPropagation();
  }, listenerOptions);

  root.querySelectorAll("[data-action='switch-locale']").forEach((button) => {
    button.addEventListener("click", () => {
      state.locale = state.locale === "en" ? "zh" : "en";
      storeLocale(state.locale);
      render();
    }, listenerOptions);
  });

  root.querySelectorAll("[data-theme-choice]").forEach((button) => {
    button.addEventListener("click", () => {
      state.themePreference = normalizeThemePreference(button.dataset.themeChoice);
      state.theme = state.themePreference === "system" ? systemThemeName() : state.themePreference;
      storeThemePreference(state.themePreference);
      render();
    }, listenerOptions);
  });

  root.querySelectorAll("[data-action='toggle-filter-panel']").forEach((button) => {
    button.addEventListener("click", () => {
      state.filterPanelOpen = !state.filterPanelOpen;
      render();
    }, listenerOptions);
  });

  root.querySelectorAll("[data-share-frame]").forEach((button) => {
    button.addEventListener("click", () => {
      state.shareFrame = button.dataset.shareFrame === "square" ? "square" : "wide";
      renderMainRegion();
    }, listenerOptions);
  });

  root.querySelectorAll("[data-action='set-win-streak-policy']").forEach((button) => {
    button.addEventListener("click", () => {
      state.winStreakPolicy = button.dataset.winStreakPolicy === "skipUnknown" ? "skipUnknown" : "breakUnknown";
      storeWinStreakPolicy(state.winStreakPolicy);
      renderMainRegion();
    }, listenerOptions);
  });

  root.querySelectorAll("[data-action='set-overview-sort']").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.overviewSortKind === "mode") {
        state.overviewModeSort = normalizeOverviewModeSort(button.dataset.overviewSort);
      }
      if (button.dataset.overviewSortKind === "source") {
        state.overviewSourceSort = button.dataset.overviewSort === "client" ? "client" : "duration";
      }
      if (button.dataset.overviewSortKind === "server") {
        state.overviewServerSort = button.dataset.overviewSort === "name" ? "name" : "duration";
      }
      renderMainRegion();
    }, listenerOptions);
  });

  root.querySelectorAll("[data-share-kind]").forEach((button) => {
    button.addEventListener("click", () => {
      state.shareKind = normalizeShareKind(button.dataset.shareKind);
      renderMainRegion();
    }, listenerOptions);
  });

  root.querySelectorAll("[data-share-mode-metric]").forEach((button) => {
    button.addEventListener("click", () => {
      state.shareModeMetric = button.dataset.shareModeMetric === "playtime" ? "playtime" : "rounds";
      renderMainRegion();
    }, listenerOptions);
  });

  root.querySelectorAll("[data-share-bar-slot]").forEach((button) => {
    button.addEventListener("click", () => {
      const kind = normalizeShareBarKind(button.dataset.shareBarKind);
      if (button.dataset.shareBarSlot === "primary") {
        state.sharePrimaryBar = kind;
        if (state.shareSecondaryBar === kind) state.shareSecondaryBar = kind === "server" ? "mode" : "server";
      } else {
        state.shareSecondaryBar = kind;
        if (state.sharePrimaryBar === kind) state.sharePrimaryBar = kind === "server" ? "mode" : "server";
      }
      renderMainRegion();
    }, listenerOptions);
  });

  root.querySelector("[data-share-stat-add]")?.addEventListener("change", (event) => {
    addShareStatSlot(event.target.value);
    renderMainRegion();
  }, listenerOptions);

  root.querySelectorAll("[data-action='add-share-stat']").forEach((button) => {
    button.addEventListener("click", () => {
      addShareStatSlot(button.dataset.shareStat);
      renderMainRegion();
    }, listenerOptions);
  });

  root.querySelectorAll("[data-action='move-share-stat']").forEach((button) => {
    button.addEventListener("click", () => {
      moveShareStatSlot(button.dataset.shareStat, Number(button.dataset.shareStatStep ?? 0));
      renderMainRegion();
    }, listenerOptions);
  });

  root.querySelectorAll("[data-action='remove-share-stat']").forEach((button) => {
    button.addEventListener("click", () => {
      removeShareStatSlot(button.dataset.shareStat);
      renderMainRegion();
    }, listenerOptions);
  });
  bindShareStatDragInteractions(listenerOptions);

  root.querySelectorAll("[data-view-kind]").forEach((button) => {
    button.addEventListener("click", () => {
      setViewMode(button.dataset.viewKind, button.dataset.viewMode);
      renderMainRegion();
    }, listenerOptions);
  });

  root.querySelectorAll("[data-action='set-match-sort']").forEach((button) => {
    button.addEventListener("click", async () => {
      await setMatchSort(button.dataset.matchSort);
    }, listenerOptions);
  });

  root.querySelectorAll("[data-audit-filter]").forEach((element) => {
    element.addEventListener("change", async (event) => {
      state.auditFilters[event.target.dataset.auditFilter] = event.target.value;
      resetAuditOutputs();
      await refreshAuditData({ resetPage: true });
      renderMainRegion();
    }, listenerOptions);
  });

  root.querySelectorAll("[data-audit-filter-button]").forEach((button) => {
    button.addEventListener("click", async () => {
      const kind = button.dataset.auditFilterButton;
      if (kind) state.auditFilters[kind] = button.dataset.auditFilterValue ?? "";
      resetAuditOutputs();
      await refreshAuditData({ resetPage: true });
      renderMainRegion();
    }, listenerOptions);
  });

  root.querySelector("[data-action='dismiss-audit-oobe']")?.addEventListener("click", () => {
    state.auditOobeOpen = false;
    storeAuditOobeDismissed();
    renderMainRegion();
  }, listenerOptions);

  root.querySelectorAll("[data-action='select-audit-round']").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeAuditRoundKey = button.dataset.auditRoundKey ?? "";
      renderMainRegion();
    }, listenerOptions);
  });

  root.querySelectorAll("[data-audit-label]").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.auditRoundKey ?? "";
      const current = state.auditLabels[key] ?? {};
      state.auditLabels[key] = { ...current, label: button.dataset.auditLabel ?? "", roundRefSeed: auditRoundRefSeed(findAuditRound(key)) };
      resetAuditOutputs();
      renderMainRegion();
      showToast(auditCopy("labelSaved"), "success");
    }, listenerOptions);
  });

  root.querySelectorAll("[data-audit-field]").forEach((field) => {
    field.addEventListener("input", (event) => {
      const key = event.target.dataset.auditRoundKey ?? "";
      const name = event.target.dataset.auditField;
      const current = state.auditLabels[key] ?? {};
      state.auditLabels[key] = { ...current, [name]: event.target.value, roundRefSeed: current.roundRefSeed ?? auditRoundRefSeed(findAuditRound(key)) };
      resetAuditOutputs();
    }, listenerOptions);
    field.addEventListener("change", (event) => {
      const key = event.target.dataset.auditRoundKey ?? "";
      const name = event.target.dataset.auditField;
      const current = state.auditLabels[key] ?? {};
      state.auditLabels[key] = { ...current, [name]: event.target.value, roundRefSeed: current.roundRefSeed ?? auditRoundRefSeed(findAuditRound(key)) };
      resetAuditOutputs();
      renderMainRegion();
    }, listenerOptions);
  });

  root.querySelector("[data-action='refresh-audit-data']")?.addEventListener("click", async () => {
    await refreshAuditData();
    renderMainRegion();
    showToast(auditCopy("refreshed"), "success");
  }, listenerOptions);

  root.querySelector("[data-action='audit-status']")?.addEventListener("click", runAuditStatus, listenerOptions);
  root.querySelector("[data-action='audit-validate-labels']")?.addEventListener("click", runAuditValidation, listenerOptions);
  root.querySelector("[data-action='audit-run-workflow']")?.addEventListener("click", runAuditWorkflow, listenerOptions);

  root.querySelectorAll("[data-rule-field]").forEach((field) => {
    field.addEventListener("input", (event) => {
      updateRuleField(event.target.dataset.ruleField, event.target.value);
    }, listenerOptions);
    field.addEventListener("change", (event) => {
      updateRuleField(event.target.dataset.ruleField, event.target.value);
      renderMainRegion();
    }, listenerOptions);
  });

  root.querySelector("[data-action='rule-test-message']")?.addEventListener("click", runRuleTest, listenerOptions);
  root.querySelector("[data-action='rule-draft-message']")?.addEventListener("click", runRuleDraft, listenerOptions);
  root.querySelector("[data-action='validate-rule-pack-json']")?.addEventListener("click", validateRulePackJson, listenerOptions);
  root.querySelector("[data-action='dry-run-rule-pack-json']")?.addEventListener("click", dryRunRulePackJson, listenerOptions);
  root.querySelector("[data-action='save-rule-pack-json']")?.addEventListener("click", saveRulePackJson, listenerOptions);

  root.querySelectorAll("[data-action='load-user-rule-pack']").forEach((button) => {
    button.addEventListener("click", () => loadUserRulePack(button.dataset.rulePackId), listenerOptions);
  });

  root.querySelectorAll("[data-action='toggle-user-rule-pack']").forEach((button) => {
    button.addEventListener("click", () => toggleUserRulePack(button.dataset.rulePackId, button.dataset.rulePackEnabled === "true"), listenerOptions);
  });

  root.querySelectorAll("[data-action='load-rule-backups']").forEach((button) => {
    button.addEventListener("click", () => loadUserRulePackBackups(button.dataset.rulePackId), listenerOptions);
  });

  root.querySelectorAll("[data-action='restore-rule-backup']").forEach((button) => {
    button.addEventListener("click", () => restoreUserRulePackBackup(button.dataset.rulePackId, button.dataset.ruleBackupId), listenerOptions);
  });

  root.querySelectorAll("[data-action='delete-user-rule-pack']").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.rulePackId;
      if (!id || !window.confirm(auditCopy("confirmDeleteRulePack", { id }))) return;
      deleteUserRulePack(id);
    }, listenerOptions);
  });

  root.querySelectorAll("[data-page-kind]").forEach((button) => {
    button.addEventListener("click", async () => {
      await stepPage(button.dataset.pageKind, Number(button.dataset.pageStep ?? 0));
    }, listenerOptions);
  });

  root.querySelectorAll("[data-action='open-round-detail']").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.roundKey ?? "";
      openRoundDetail(findRoundByDetailKey(key), key);
      renderMainRegion();
    }, listenerOptions);
  });

  root.querySelectorAll("[data-action='close-round-detail']").forEach((button) => {
    button.addEventListener("click", () => {
      closeRoundDetail();
      renderMainRegion();
    }, listenerOptions);
  });

  root.querySelectorAll("[data-action='toggle-round-debug']").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const key = button.dataset.roundKey ?? "";
      state.roundDebugOpenKey = state.roundDebugOpenKey === key ? "" : key;
      renderMainRegion();
    }, listenerOptions);
  });

  root.querySelectorAll("[data-tape-round]").forEach((button) => {
    ["pointerover", "pointerenter"].forEach((eventName) => {
      button.addEventListener(eventName, (event) => {
        showTapeTooltip(button.dataset.tapeRound ?? "", event);
      }, listenerOptions);
    });
    button.addEventListener("pointermove", (event) => {
      const tooltip = document.querySelector(".tape-tooltip.visible");
      if (tooltip) positionTapeTooltip(tooltip, event);
    }, listenerOptions);
    button.addEventListener("pointerleave", hideTapeTooltip, listenerOptions);
    button.addEventListener("focus", (event) => {
      showTapeTooltip(button.dataset.tapeRound ?? "", event);
    }, listenerOptions);
    button.addEventListener("blur", hideTapeTooltip, listenerOptions);
    button.addEventListener("click", (event) => {
      event.preventDefault();
      openTapeRoundDetail(button.dataset.tapeRound ?? "");
      renderMainRegion();
    }, listenerOptions);
  });

  root.querySelectorAll("[data-heat-day]").forEach((cell) => {
    ["pointerover", "pointerenter"].forEach((eventName) => {
      cell.addEventListener(eventName, (event) => {
        showHeatTooltip(cell, event);
      }, listenerOptions);
    });
    cell.addEventListener("pointermove", (event) => {
      const tooltip = document.querySelector(".tape-tooltip.visible");
      if (tooltip) positionTapeTooltip(tooltip, event);
    }, listenerOptions);
    cell.addEventListener("pointerleave", hideTapeTooltip, listenerOptions);
    cell.addEventListener("focus", (event) => {
      showHeatTooltip(cell, event);
    }, listenerOptions);
    cell.addEventListener("blur", hideTapeTooltip, listenerOptions);
    cell.addEventListener("click", (event) => {
      showHeatTooltip(cell, event);
    }, listenerOptions);
  });

  root.querySelector("[data-action='heatmap-older']")?.addEventListener("click", () => {
    state.heatmapWindowIndex = clampHeatmapWindowIndex(state.heatmapWindowIndex + 1);
    renderMainRegion();
  }, listenerOptions);

  root.querySelector("[data-action='heatmap-newer']")?.addEventListener("click", () => {
    state.heatmapWindowIndex = clampHeatmapWindowIndex(state.heatmapWindowIndex - 1);
    renderMainRegion();
  }, listenerOptions);

  root.querySelector("[data-action='heatmap-earliest']")?.addEventListener("click", () => {
    state.heatmapWindowIndex = buildContributionCalendar(state.daySeries?.items ?? [], 0).maxWindowIndex;
    renderMainRegion();
  }, listenerOptions);

  root.querySelector("[data-action='heatmap-latest']")?.addEventListener("click", () => {
    state.heatmapWindowIndex = 0;
    renderMainRegion();
  }, listenerOptions);

  root.querySelectorAll("[data-action='toggle-profile-aliases']").forEach((button) => {
    button.addEventListener("click", () => {
      const input = root.querySelector("[data-profile-name]");
      if (input) state.profileDraftName = input.value;
      state.profileAliasOpen = !state.profileAliasOpen;
      render();
    }, listenerOptions);
  });

  root.querySelector("[data-profile-name]")?.addEventListener("input", (event) => {
    state.profileDraftName = event.target.value;
  }, listenerOptions);

  root.querySelectorAll("[data-action='fill-profile-name']").forEach((button) => {
    button.addEventListener("click", () => {
      state.profileDraftName = button.dataset.aliasName ?? "";
      state.profileAliasOpen = false;
      render();
      root.querySelector("[data-profile-name]")?.focus({ preventScroll: true });
    }, listenerOptions);
  });

  root.querySelectorAll("[data-action='save-player-profile']").forEach((button) => {
    button.addEventListener("click", async () => {
      const panel = button.closest(".profile-picker");
      const input = panel?.querySelector("[data-profile-name]") ?? root.querySelector("[data-profile-name]");
      await applyPlayerProfileName(input?.value);
    }, listenerOptions);
  });

  root.querySelector("[data-action='load-avatar-username']")?.addEventListener("click", async () => {
    const input = root.querySelector("[data-profile-name], [data-avatar-username]");
    await applyPlayerProfileName(input?.value);
  }, listenerOptions);

  root.querySelectorAll("[data-action='dismiss-avatar-fallback']").forEach((button) => {
    button.addEventListener("click", () => {
      state.avatarFallback = null;
      render();
    }, listenerOptions);
  });

  async function applyPlayerProfileName(rawName) {
    if (state.avatarLoading) return;
    try {
      const cleanName = normalizeDisplayName(rawName);
      state.avatarLoading = true;
      state.avatarFallback = null;
      showToast(t("avatar.loading"), "info");
      await loadAvatarFromUsername(cleanName);
      state.avatarLoading = false;
      state.profileEditorOpen = false;
      state.profileAliasOpen = false;
      state.profileDraftName = null;
      render();
      showToast(t("avatar.loaded"), "success");
    } catch (error) {
      state.avatarLoading = false;
      render();
      showToast(error.code === "invalid_display_name" ? t("avatar.invalidName") : t("avatar.failed"), "error");
    }
  }

  root.querySelectorAll("[data-avatar-upload]").forEach((input) => {
    input.addEventListener("change", async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      try {
        state.avatarLoading = true;
        render();
        await loadAvatarFromFile(file);
        state.avatarLoading = false;
        state.profileEditorOpen = false;
        render();
        showToast(t("avatar.uploadReady"), "success");
      } catch {
        state.avatarLoading = false;
        render();
        showToast(t("avatar.uploadFailed"), "error");
      }
    }, listenerOptions);
  });

  root.querySelectorAll("[data-action='reset-avatar']").forEach((button) => {
    button.addEventListener("click", () => {
      resetAvatar();
      state.profileEditorOpen = false;
      render();
      showToast(t("avatar.resetDone"), "success");
    }, listenerOptions);
  });

  root.querySelectorAll("[data-action='clear-filters']").forEach((button) => {
    button.addEventListener("click", async () => {
      state.filters = { mode: "", result: "", source: "" };
      state.query = "";
      resetRoundPaging();
      await refreshRounds();
      showToast(t("toast.filtersCleared"), "success");
    }, listenerOptions);
  });

  root.querySelectorAll("[data-action='refresh-report']").forEach((button) => {
    button.addEventListener("click", startRefresh, listenerOptions);
  });

  root.querySelector("[data-action='download-share-card']")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const label = button.querySelector("span:last-child");
    const previous = label.textContent;
    label.textContent = t("actions.generating");
    button.disabled = true;
    try {
      if (state.shareKind === "matches" && (state.query.trim() || state.filters.mode || state.filters.result || state.filters.source)) {
        await ensureRoundContextCache();
      }
      await downloadShareCardPng(buildShareCardData(buildViewModel()), state.shareFrame);
      label.textContent = t("actions.downloaded");
      showToast(t("toast.pngDownloaded", { frame: state.shareFrame === "square" ? t("share.square") : t("share.wide") }), "success");
    } catch {
      label.textContent = t("actions.exportFailed");
      showToast(t("toast.pngFailed"), "error");
    } finally {
      window.setTimeout(() => {
        label.textContent = previous;
        button.disabled = false;
      }, 1400);
    }
  }, listenerOptions);

  root.querySelector("[data-action='copy-summary']")?.addEventListener("click", async (event) => {
    const label = event.currentTarget.querySelector("span:last-child");
    try {
      if (state.shareKind === "matches" && (state.query.trim() || state.filters.mode || state.filters.result || state.filters.source)) {
        await ensureRoundContextCache();
      }
      const text = createShareText(buildShareCardData(buildViewModel()));
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable.");
      await navigator.clipboard.writeText(text);
      label.textContent = t("actions.copied");
      showToast(t("toast.copied"), "success");
    } catch {
      label.textContent = t("actions.copyFailed");
      showToast(t("toast.copyFailed"), "error");
    }
  }, listenerOptions);
}

function bindShareStatDragInteractions(listenerOptions) {
  const slotsElement = root.querySelector(".share-stat-slots");
  if (!slotsElement) return;
  root.querySelectorAll("[data-share-stat-drag-handle]").forEach((handle) => {
    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== undefined && event.button !== 0) return;
      const token = handle.closest("[data-share-stat-slot]");
      if (!token || !slotsElement.contains(token)) return;
      event.preventDefault();
      startShareStatDrag({ event, handle, token, slotsElement, listenerOptions });
    }, listenerOptions);
  });
}

function startShareStatDrag({ event, handle, token, slotsElement, listenerOptions }) {
  const pointerId = event.pointerId;
  const draggedKey = token.dataset.shareStatSlot;
  const tokenRect = token.getBoundingClientRect();
  const pointerOffset = {
    x: event.clientX - tokenRect.left,
    y: event.clientY - tokenRect.top,
  };
  const placeholder = createShareStatPlaceholder(token);
  const ghost = createShareStatGhost(token, tokenRect, pointerOffset);
  let targetIndex = Math.max(0, shareStatPlaceholderIndex(slotsElement, placeholder));
  let settled = false;

  slotsElement.setPointerCapture?.(pointerId);
  slotsElement.replaceChild(placeholder, token);
  document.body.appendChild(ghost);
  slotsElement.classList.add("is-dragging");
  document.body.classList.add("share-stat-drag-active");

  const updateDrag = (moveEvent) => {
    if (moveEvent.pointerId !== pointerId) return;
    moveEvent.preventDefault();
    moveShareStatGhost(ghost, moveEvent, pointerOffset);
    const nextIndex = shareStatDropIndex(slotsElement, placeholder, moveEvent);
    if (nextIndex !== targetIndex) {
      targetIndex = nextIndex;
      moveShareStatPlaceholderInDom(slotsElement, placeholder, targetIndex);
    }
  };

  const finishDrag = (finishEvent, commit) => {
    if (settled || finishEvent.pointerId !== pointerId) return;
    settled = true;
    window.removeEventListener("pointermove", updateDrag);
    window.removeEventListener("pointerup", finishDrop);
    window.removeEventListener("pointercancel", cancelDrop);
    slotsElement.removeEventListener("lostpointercapture", finishDrop);
    const finalOrder = commit ? shareStatOrderWithDraggedItem(slotsElement, placeholder, draggedKey) : null;
    if (slotsElement.hasPointerCapture?.(pointerId)) {
      try {
        slotsElement.releasePointerCapture(pointerId);
      } catch {
        // Ignore release errors when the browser already dropped capture.
      }
    }
    ghost.remove();
    placeholder.remove();
    slotsElement.classList.remove("is-dragging");
    document.body.classList.remove("share-stat-drag-active");
    if (finalOrder) storeShareStatSlots(finalOrder);
    renderMainRegion();
  };

  const finishDrop = (finishEvent) => finishDrag(finishEvent, true);
  const cancelDrop = (finishEvent) => finishDrag(finishEvent, true);

  updateDrag(event);
  window.addEventListener("pointermove", updateDrag, listenerOptions);
  window.addEventListener("pointerup", finishDrop, listenerOptions);
  window.addEventListener("pointercancel", cancelDrop, listenerOptions);
  slotsElement.addEventListener("lostpointercapture", finishDrop, listenerOptions);
}

function createShareStatPlaceholder(token) {
  const placeholder = token.cloneNode(true);
  placeholder.classList.add("share-stat-placeholder");
  placeholder.setAttribute("aria-hidden", "true");
  placeholder.dataset.shareStatPlaceholder = "1";
  return placeholder;
}

function createShareStatGhost(token, rect, pointerOffset) {
  const ghost = token.cloneNode(true);
  ghost.classList.add("share-stat-ghost");
  ghost.setAttribute("aria-hidden", "true");
  ghost.removeAttribute("data-share-stat-index");
  ghost.style.width = `${rect.width}px`;
  ghost.style.height = `${rect.height}px`;
  ghost.style.transform = `translate3d(${rect.left}px, ${rect.top}px, 0)`;
  ghost.style.willChange = "transform";
  ghost.style.pointerEvents = "none";
  moveShareStatGhost(ghost, { clientX: rect.left + pointerOffset.x, clientY: rect.top + pointerOffset.y }, pointerOffset);
  return ghost;
}

function moveShareStatGhost(ghost, event, pointerOffset) {
  ghost.style.transform = `translate3d(${event.clientX - pointerOffset.x}px, ${event.clientY - pointerOffset.y}px, 0)`;
}

function shareStatDropIndex(slotsElement, draggingToken, event) {
  const tokens = shareStatDropTokens(slotsElement, draggingToken);
  if (!tokens.length) return 0;
  const hoveredToken = document.elementFromPoint(event.clientX, event.clientY)
    ?.closest?.("[data-share-stat-slot]");
  const targetToken = hoveredToken && slotsElement.contains(hoveredToken) && hoveredToken !== draggingToken
    ? hoveredToken
    : nearestShareStatToken(tokens, event.clientX, event.clientY);
  const targetPosition = Math.max(0, tokens.indexOf(targetToken));
  const after = shareStatPointerAfterToken(tokens, targetToken, event.clientX, event.clientY);
  return clamp(targetPosition + (after ? 1 : 0), 0, tokens.length);
}

function shareStatDropTokens(slotsElement, draggingToken) {
  return [...slotsElement.querySelectorAll("[data-share-stat-slot]")]
    .filter((token) => token !== draggingToken && !token.dataset.shareStatPlaceholder);
}

function nearestShareStatToken(tokens, x, y) {
  return tokens.reduce((best, token) => {
    const rect = token.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const distance = (centerX - x) ** 2 + (centerY - y) ** 2;
    return !best || distance < best.distance ? { token, distance } : best;
  }, null)?.token ?? tokens[0];
}

function shareStatPointerAfterToken(tokens, targetToken, x, y) {
  const rect = targetToken.getBoundingClientRect();
  const centerY = rect.top + rect.height / 2;
  const sameRowCount = tokens.filter((token) => {
    const tokenRect = token.getBoundingClientRect();
    const tokenCenterY = tokenRect.top + tokenRect.height / 2;
    return Math.abs(tokenCenterY - centerY) < Math.max(12, Math.min(rect.height, tokenRect.height) * 0.45);
  }).length;
  if (sameRowCount > 1) return x > rect.left + rect.width / 2;
  return y > centerY;
}

function moveShareStatPlaceholderInDom(slotsElement, placeholder, targetIndex) {
  const tokens = shareStatDropTokens(slotsElement, placeholder);
  const normalizedTarget = clamp(targetIndex, 0, tokens.length);
  const beforeRects = shareStatTokenRects(slotsElement);
  slotsElement.insertBefore(placeholder, tokens[normalizedTarget] ?? null);
  animateShareStatReflow(slotsElement, beforeRects, placeholder);
}

function shareStatPlaceholderIndex(slotsElement, placeholder) {
  let index = 0;
  for (const current of slotsElement.querySelectorAll("[data-share-stat-slot]")) {
    if (current === placeholder) return index;
    if (current.dataset.shareStatPlaceholder) continue;
    index += 1;
  }
  return index;
}

function shareStatDomOrder(slotsElement) {
  return [...slotsElement.querySelectorAll("[data-share-stat-slot]")]
    .filter((token) => !token.dataset.shareStatPlaceholder)
    .map((token) => token.dataset.shareStatSlot)
    .filter(Boolean);
}

function shareStatOrderWithDraggedItem(slotsElement, placeholder, draggedKey) {
  const order = shareStatDomOrder(slotsElement);
  const index = clamp(shareStatPlaceholderIndex(slotsElement, placeholder), 0, order.length);
  order.splice(index, 0, draggedKey);
  return normalizeShareStatSlots(order);
}

function shareStatTokenRects(slotsElement) {
  return new Map([...slotsElement.querySelectorAll("[data-share-stat-slot]")].filter((token) => !token.dataset.shareStatPlaceholder).map((token) => [
    token,
    token.getBoundingClientRect(),
  ]));
}

function animateShareStatReflow(slotsElement, beforeRects, placeholder) {
  for (const token of slotsElement.querySelectorAll("[data-share-stat-slot]")) {
    if (token === placeholder || token.dataset.shareStatPlaceholder) continue;
    const before = beforeRects.get(token);
    if (!before) continue;
    const after = token.getBoundingClientRect();
    const dx = before.left - after.left;
    const dy = before.top - after.top;
    if (!dx && !dy) continue;
    token.animate([
      { transform: `translate(${dx}px, ${dy}px)` },
      { transform: "translate(0, 0)" },
    ], {
      duration: 145,
      easing: "ease-out",
    });
  }
}

function setViewMode(kind, mode) {
  const normalized = mode === "list" ? "list" : "cards";
  if (kind === "matches") {
    state.matchesViewMode = normalized;
    state.matchesPage = 0;
  }
  if (kind === "modes") {
    state.modesViewMode = normalized;
    state.modesPage = 0;
  }
  if (kind === "identity") {
    state.identityViewMode = normalized;
    state.identityPage = 0;
  }
}

async function setMatchSort(sort) {
  const normalized = sort === "oldest" ? "oldest" : "newest";
  if (state.matchesSort === normalized) return;
  state.matchesSort = normalized;
  state.matchesPage = 0;
  state.activeRoundDetail = null;
  state.roundDetailReturnTab = "matches";
  state.roundDebugOpenKey = "";
  if (state.activeTab === "matches" && state.query.trim()) await ensureRoundContextCache();
  if (state.activeTab === "matches" && !state.query.trim()) await refreshRounds();
  else renderMainRegion();
}

async function stepPage(kind, step) {
  if (kind === "matches") {
    state.matchesPage = Math.max(0, state.matchesPage + step);
    state.expandedRoundKey = "";
    if (!state.query.trim()) await refreshRounds();
    renderMainRegion();
    return;
  }
  if (kind === "modes") state.modesPage = Math.max(0, state.modesPage + step);
  if (kind === "identity") state.identityPage = Math.max(0, state.identityPage + step);
  if (kind === "audit") {
    state.auditPage = Math.max(0, state.auditPage + step);
    await refreshAuditData();
    renderMainRegion();
    return;
  }
  renderMainRegion();
}

function normalizeShareKind(value) {
  return ["overview", "matches", "modes", "identity"].includes(value) ? value : "overview";
}

function bindSetupInteractions() {
  root.querySelectorAll("[data-action='switch-locale']").forEach((button) => {
    button.addEventListener("click", () => {
      state.locale = state.locale === "en" ? "zh" : "en";
      storeLocale(state.locale);
      renderSetup();
    });
  });

  root.querySelectorAll("[data-theme-choice]").forEach((button) => {
    button.addEventListener("click", () => {
      state.themePreference = normalizeThemePreference(button.dataset.themeChoice);
      state.theme = state.themePreference === "system" ? systemThemeName() : state.themePreference;
      storeThemePreference(state.themePreference);
      renderSetup();
    });
  });

  root.querySelector("[data-oobe-roots]")?.addEventListener("input", (event) => {
    state.oobe.rootText = event.target.value;
    state.oobe.validation = null;
    state.oobe.error = "";
    state.oobe.message = "";
  });

  root.querySelector("[data-action='choose-log-root']")?.addEventListener("click", chooseLogRoot);
  root.querySelector("[data-action='validate-log-roots']")?.addEventListener("click", validateOobeRoots);
  root.querySelector("[data-action='save-log-roots']")?.addEventListener("click", saveOobeRoots);
  root.querySelector("[data-action='run-oobe-refresh']")?.addEventListener("click", startOobeRefresh);
}

async function chooseLogRoot() {
  state.oobe.error = "";
  state.oobe.message = "";
  state.oobe.picking = true;
  showToast(t("oobe.pickerOpened"), "info");
  renderSetup();
  try {
    const result = await postJson("/api/system/select-directory", { validate: true });
    if (result.cancelled) {
      state.oobe.message = t("oobe.pickerCancelled");
      showToast(t("oobe.pickerCancelled"), "info");
    } else if (result.path) {
      const roots = unique([...parseOobeRoots(), result.path]);
      state.oobe.rootText = roots.join("\n");
      state.oobe.validation = result.validation ?? null;
      state.oobe.message = result.validation?.ok
        ? t("oobe.validationPassed", { files: formatNumber(totalValidationFiles(result.validation)), scopes: formatNumber(totalValidationScopes(result.validation)) })
        : t("oobe.pickerSelected");
      state.oobe.error = result.validation && !result.validation.ok ? t("oobe.validationFailed") : "";
      showToast(t("oobe.pickerSelected"), "success");
    } else {
      state.oobe.error = t("oobe.pickerUnavailable");
      showToast(t("oobe.pickerUnavailable"), "error");
    }
  } catch {
    state.oobe.error = t("oobe.pickerUnavailable");
    showToast(t("oobe.pickerUnavailable"), "error");
  } finally {
    state.oobe.picking = false;
  }
  renderSetup();
}

async function validateOobeRoots() {
  const roots = parseOobeRoots();
  if (!roots.length) {
    state.oobe.error = t("oobe.required");
    state.oobe.message = "";
    renderSetup();
    return null;
  }
  state.oobe.validating = true;
  state.oobe.error = "";
  state.oobe.message = "";
  renderSetup();
  try {
    const validation = await postJson("/api/config/validate-roots", { roots });
    state.oobe.validation = validation;
    state.oobe.message = validation.ok
      ? t("oobe.validationPassed", { files: formatNumber(totalValidationFiles(validation)), scopes: formatNumber(totalValidationScopes(validation)) })
      : "";
    state.oobe.error = validation.ok ? "" : t("oobe.validationFailed");
    return validation;
  } catch (error) {
    const validation = error.detail;
    if (validation?.roots) state.oobe.validation = validation;
    state.oobe.error = validation?.message || t("oobe.validationFailed");
    return validation ?? null;
  } finally {
    state.oobe.validating = false;
    renderSetup();
  }
}

async function saveOobeRoots() {
  const roots = parseOobeRoots();
  if (!roots.length) {
    state.oobe.error = t("oobe.required");
    state.oobe.message = "";
    renderSetup();
    return;
  }

  state.oobe.saving = true;
  state.oobe.error = "";
  state.oobe.message = "";
  renderSetup();
  try {
    const validation = state.oobe.validation?.ok ? state.oobe.validation : await postJson("/api/config/validate-roots", { roots });
    state.oobe.validation = validation;
    if (!validation.ok) {
      state.oobe.error = t("oobe.validationFailed");
      return;
    }
    await putJson("/api/config", { roots });
    state.oobe.message = t("oobe.saved");
    state.appStatus = await getJson("/api/app/status");
    await startOobeRefresh();
  } catch (error) {
    const validation = error.detail;
    if (validation?.roots) state.oobe.validation = validation;
    state.oobe.error = validation?.message || error.message || t("refresh.requestFailed");
  } finally {
    state.oobe.saving = false;
    renderSetup();
  }
}

async function startOobeRefresh() {
  await startRefresh({ setup: true });
}

function parseOobeRoots() {
  return unique(String(state.oobe.rootText ?? "")
    .split(/\r?\n|;/)
    .map((item) => item.trim().replace(/^"|"$/g, ""))
    .filter(Boolean));
}

function totalValidationFiles(validation) {
  return (validation?.roots ?? []).reduce((sum, item) => sum + Number(item.logFiles ?? 0), 0);
}

function totalValidationScopes(validation) {
  return (validation?.roots ?? []).reduce((sum, item) => sum + Number(item.scopes ?? 0), 0);
}

function showToast(message, tone = "info") {
  window.clearTimeout(toastTimer);
  state.toast = { message, tone };
  if (state.setupMode) renderSetup();
  else updateToastRegion();
  toastTimer = window.setTimeout(() => {
    state.toast = null;
    if (state.setupMode) renderSetup();
    else updateToastRegion();
  }, 2400);
}

function createShareText(data) {
  const lines = [
    `${data.playerName} - MC Log Analytics`,
    t("share.shareTextPlay", { playtime: data.playtime, rounds: data.reliableRounds, winRate: data.winRate }),
    t("share.shareTextKd", { kd: data.selfKd, winsLosses: data.winsLosses, streak: data.peakStreak, currentStreak: data.currentWinStreak, killStreak: data.playerMaxKillStreak }),
    t("share.shareTextLogs", { files: data.files, chatLines: data.chatLines }),
  ];

  lines.push(t("share.generatedLine", { date: data.generated }));
  return lines.join("\n");
}

async function downloadShareCardPng(data, frame) {
  const { width, height } = shareExportFrameSize(frame);
  const svg = buildShareCardSvg(data, frame, { exportScale: width / shareFrameSize(frame).width });
  const svgBlob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const svgUrl = URL.createObjectURL(svgBlob);

  try {
    const image = await loadImage(svgUrl);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0, width, height);
    const pngBlob = await pngBlobWithDpi(await canvasToBlob(canvas), SHARE_EXPORT_DPI);
    const pngUrl = URL.createObjectURL(pngBlob);
    const link = document.createElement("a");
    link.href = pngUrl;
    link.download = `mc-log-card-${safeFilename(data.playerName)}-${data.kind}-${frame}.png`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(pngUrl), 1000);
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

function buildShareCardSvg(data, frame, options = {}) {
  const square = frame === "square";
  const palette = shareThemePalette(data.theme);
  const baseSize = shareFrameSize(frame);
  const exportScale = Number.isFinite(options.exportScale) && options.exportScale > 0 ? options.exportScale : 1;
  const width = Math.round(baseSize.width * exportScale);
  const height = Math.round(baseSize.height * exportScale);
  const designWidth = baseSize.width;
  const designHeight = baseSize.height;
  const padX = square ? 78 : 76;
  const padY = square ? 74 : 66;
  const contentW = designWidth - padX * 2;
  const statCols = 4;
  const statGap = square ? 12 : 14;
  const statCellW = Math.floor((contentW - statGap * (statCols - 1)) / statCols);
  const statCellH = square ? 78 : 76;
  const statY = square ? 456 : 304;
  const avatarSize = square ? 96 : 108;
  const playerY = square ? 150 : 150;
  const playerTextX = padX + avatarSize + 22;
  const spotlightX = square ? padX : padX + 610;
  const spotlightY = square ? 310 : 140;
  const spotlightW = square ? contentW : designWidth - padX - spotlightX;
  const wlBarW = square ? 520 : 880;
  const tape = data.tape.slice(0, shareTapeLimit(frame));
  const tapeSummary = shareTapeSummary(tape);
  const winTextColor = svgMetricColor(data.wins, positiveTone(data.wins), palette);
  const lossTextColor = svgMetricColor(data.losses, positiveTone(data.losses, "loss"), palette);
  const streakTextColor = svgMetricColor(data.peakStreak, positiveTone(data.peakStreak), palette);
  const wlTextY = square ? 585 : 424;
  const wlBarY = square ? 568 : 407;
  const barOne = data.shareBars[0];
  const barTwo = data.shareBars[1];
  const barOneY = square ? 650 : 480;
  const barTwoY = square ? 786 : 618;
  const metrics = shareSupportingStats(data, frame);
  const barHeight = square ? 118 : 108;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${designWidth} ${designHeight}">
  <defs>
    <pattern id="grid" width="48" height="48" patternUnits="userSpaceOnUse">
      <path d="M 48 0 L 0 0 0 48" fill="none" stroke="${palette.accent}" stroke-opacity="${palette.gridOpacity}" stroke-width="2"/>
    </pattern>
    <linearGradient id="topGlow" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${palette.accent}" stop-opacity="${palette.glowOpacity}"/>
      <stop offset="1" stop-color="${palette.accent}" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="winFill" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${palette.green}"/>
      <stop offset="1" stop-color="${palette.greenDim}"/>
    </linearGradient>
  </defs>
  <rect width="${designWidth}" height="${designHeight}" rx="${square ? 42 : 36}" fill="${palette.background}"/>
  <rect width="${designWidth}" height="${designHeight}" fill="url(#grid)"/>
  <rect width="${designWidth}" height="${Math.round(designHeight * 0.35)}" fill="url(#topGlow)"/>
  <rect x="0" y="${Math.round(designHeight * 0.1)}" width="4" height="${Math.round(designHeight * 0.8)}" fill="${palette.accent}" opacity="0.55"/>

  ${svgLogo(padX, padY + 3, 30, palette)}
  <text x="${padX + 48}" y="${padY + 25}" fill="${palette.brand}" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="20" font-weight="800" letter-spacing="2">MC LOG ANALYTICS</text>
  <text x="${padX + 270}" y="${padY + 25}" fill="${palette.meta}" font-family="Inter, Segoe UI, Microsoft YaHei, Arial, sans-serif" font-size="20">/ ${svgText(data.cardTitle)}</text>
  <text x="${designWidth - padX}" y="${padY + 25}" text-anchor="end" fill="${palette.meta}" font-family="Inter, Segoe UI, Microsoft YaHei, Arial, sans-serif" font-size="18">${svgText(t("common.generated"))} ${svgText(data.generated)}</text>

  ${svgAvatar(data.avatar.src, padX, playerY, avatarSize, palette)}
  <text x="${playerTextX}" y="${square ? 196 : 194}" fill="${palette.textHi}" font-family="Inter, Segoe UI, Microsoft YaHei, Arial, sans-serif" font-size="${square ? 56 : 58}" font-weight="900" letter-spacing="-3">${svgText(data.playerName)}</text>
  <text x="${playerTextX}" y="${square ? 232 : 232}" fill="${palette.text}" font-family="Inter, Segoe UI, Microsoft YaHei, Arial, sans-serif" font-size="18" font-weight="700">${svgText(data.cardSubtitle)}</text>
  ${data.badges.slice(0, square ? 3 : 2).map((badge, index) => svgChip(playerTextX + index * (square ? 220 : 218), square ? 250 : 250, badge, index === 0, palette)).join("")}

  ${svgShareSpotlights(data, { x: spotlightX, y: spotlightY, width: spotlightW, square, palette })}
  ${metrics.slice(0, square ? 4 : 4).map((metric, index) => svgShareMetric(metric, index, statCols, padX, statY, statCellW, statCellH, statGap, palette)).join("")}

  <text x="${padX}" y="${wlTextY}" fill="${winTextColor}" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="${square ? 34 : 36}" font-weight="900">${svgText(data.wins)}</text>
  <text x="${padX + 70}" y="${wlTextY}" fill="${winTextColor === palette.green ? palette.greenText : palette.text}" font-family="Inter, Segoe UI, Microsoft YaHei, Arial, sans-serif" font-size="18" font-weight="700">${svgText(t("share.win"))}</text>
  <rect x="${padX + 112}" y="${wlBarY}" width="${wlBarW}" height="10" rx="5" fill="${palette.barTrack}"/>
  <rect x="${padX + 112}" y="${wlBarY}" width="${Math.round(wlBarW * ((Number.parseInt(data.winRate, 10) || 0) / 100))}" height="10" rx="5" fill="url(#winFill)"/>
  <text x="${square ? designWidth - padX - 136 : designWidth - padX - 190}" y="${wlTextY}" fill="${lossTextColor}" font-family="Inter, Segoe UI, Microsoft YaHei, Arial, sans-serif" font-size="${square ? 34 : 36}" font-weight="900">${svgText(data.losses)}</text>
  <text x="${square ? designWidth - padX - 50 : designWidth - padX - 100}" y="${wlTextY}" fill="${lossTextColor === palette.red ? palette.redText : palette.text}" font-family="Inter, Segoe UI, Microsoft YaHei, Arial, sans-serif" font-size="18" font-weight="700">${svgText(t("share.loss"))}</text>
  <text x="${designWidth - padX}" y="${wlTextY}" text-anchor="end" fill="${streakTextColor}" font-family="Inter, Segoe UI, Microsoft YaHei, Arial, sans-serif" font-size="17">${svgText(t("share.streak", { value: data.peakStreak }))}</text>

  ${svgShareBar(data, barOne, { x: padX, y: barOneY, width: designWidth - padX * 2, square, palette, barHeight, tapeSummary })}
  ${svgShareBar(data, barTwo, { x: padX, y: barTwoY, width: designWidth - padX * 2, square, palette, barHeight, tapeSummary })}

  <line x1="${padX}" y1="${designHeight - padY - 42}" x2="${designWidth - padX}" y2="${designHeight - padY - 42}" stroke="${palette.accent}" stroke-opacity="${palette.dividerOpacity}" stroke-width="2"/>
  ${svgLogo(padX, designHeight - padY - 20, 20, palette)}
  <text x="${padX + 32}" y="${designHeight - padY - 3}" fill="${palette.meta}" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="16" font-weight="800" letter-spacing="1">MC LOG ANALYTICS</text>
  <text x="${designWidth - padX}" y="${designHeight - padY - 3}" text-anchor="end" fill="${palette.meta}" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="16">${svgText(data.footerMeta)}</text>
</svg>`;
}

function shareFrameSize(frame) {
  return frame === "square" ? { width: 1080, height: 1080 } : { width: 1600, height: 900 };
}

function shareExportFrameSize(frame) {
  return frame === "square" ? { width: 2160, height: 2160 } : { width: 3840, height: 2160 };
}

function shareTapeLimit(frame) {
  return frame === "square" ? 8 : 24;
}

function shareThemeName(theme = state.theme) {
  return theme === "light" ? "light" : "dark";
}

function shareThemePalette(theme = state.theme) {
  if (shareThemeName(theme) === "light") {
    return {
      theme: "light",
      background: "#f7faf4",
      surfaceSoft: "#f3f8ef",
      surfaceTint: "#edf7f1",
      border: "#d7e3d5",
      borderStrong: "#b8ceb8",
      gridOpacity: "0.025",
      glowOpacity: "0.06",
      dividerOpacity: "0.13",
      textHi: "#101814",
      heading: "#17241d",
      text: "#415048",
      muted: "#65756b",
      meta: "#4a5b52",
      brand: "#176b43",
      accent: "#167849",
      green: "#167849",
      greenDim: "#2e7450",
      greenText: "#176b43",
      red: "#b33a3a",
      redText: "#8c3434",
      gold: "#8a6c12",
      blue: "#286e9f",
      warn: "#c34848",
      ignored: "#7464a8",
      neutral: "#31413a",
      barTrack: "#dfe8dd",
      cardFill: "rgba(255,255,255,0.82)",
      cardStroke: "#cfded0",
      cardCornerStroke: "rgba(23,107,67,0.14)",
      avatarFill: "#edf5ec",
      avatarStroke: "#bfd6c5",
      avatarInnerStroke: "rgba(22,120,73,0.24)",
      winCell: "#72bd8d",
      lossCell: "#d67167",
      unknownCell: "#aab5ad",
      activityCell: "#bcb493",
    };
  }
  return {
    theme: "dark",
    background: "#080c0f",
    surfaceSoft: "rgba(255,255,255,0.03)",
    surfaceTint: "rgba(61,184,122,0.055)",
    border: "rgba(255,255,255,0.07)",
    borderStrong: "rgba(255,255,255,0.12)",
    gridOpacity: "0.025",
    glowOpacity: "0.09",
    dividerOpacity: "0.08",
    textHi: "#e4ecf4",
    heading: "#dbe7e0",
    text: "#9ab0a3",
    muted: "#6e8176",
    meta: "#6c8075",
    brand: "#6ccf9b",
    accent: "#3db87a",
    green: "#3db87a",
    greenDim: "#2d9060",
    greenText: "#5fc993",
    red: "#d95555",
    redText: "#d95555",
    gold: "#c4a23a",
    blue: "#5a9fd4",
    warn: "#e05a5a",
    ignored: "#9b86c8",
    neutral: "#c8d4e0",
    barTrack: "rgba(255,255,255,0.06)",
    cardFill: "rgba(255,255,255,0.04)",
    cardStroke: "rgba(255,255,255,0.08)",
    cardCornerStroke: "rgba(255,255,255,0.13)",
    avatarFill: "#0c1910",
    avatarStroke: "#1a2e20",
    avatarInnerStroke: "rgba(61,184,122,0.18)",
    winCell: "#3db87a",
    lossCell: "#d95555",
    unknownCell: "#3d4a5a",
    activityCell: "#4a4529",
  };
}

function svgLogo(x, y, size, palette = shareThemePalette()) {
  const colors = [palette.green, palette.green, palette.greenDim, palette.brand, palette.green, palette.greenDim, palette.green, palette.brand, palette.brand, palette.green, palette.greenDim, palette.green, palette.brand, palette.greenDim, palette.brand, palette.green];
  const cell = size / 4;
  return colors.map((color, index) => {
    const col = index % 4;
    const row = Math.floor(index / 4);
    return `<rect x="${(x + col * cell).toFixed(1)}" y="${(y + row * cell).toFixed(1)}" width="${(cell - 1).toFixed(1)}" height="${(cell - 1).toFixed(1)}" rx="1" fill="${color}" opacity="0.7"/>`;
  }).join("");
}

function svgChip(x, y, label, green = false, palette = shareThemePalette()) {
  const width = Math.min(280, Math.max(96, String(label ?? "").length * 11 + 34));
  return `
  <rect x="${x}" y="${y}" width="${width}" height="34" rx="7" fill="${green ? palette.surfaceTint : palette.surfaceSoft}" stroke="${green ? palette.borderStrong : palette.border}" stroke-width="2"/>
  <text x="${x + 16}" y="${y + 22}" fill="${green ? palette.greenText : palette.muted}" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="16" font-weight="700">${svgText(label)}</text>`;
}

function svgModeMix(data, options) {
  return svgShareBar(data, "mode", options);
}

function svgShareBar(data, kind, options) {
  const normalizedKind = normalizeShareBarKind(kind);
  if (normalizedKind === "tape") return svgShareTapeBar(data, options);
  const config = shareBarConfig(data, normalizedKind);
  return svgShareMixBar(config, options);
}

function svgShareMixBar(config, options) {
  const { x, y, width, palette = shareThemePalette() } = options;
  const barW = width;
  let cursor = x;
  const rows = config.rows ?? [];
  const segments = rows.map((row) => {
    const color = shareMixColor(row, palette.theme);
    const segmentW = Math.max(12, Math.round(barW * row.percent / 100));
    const rect = `<rect x="${cursor}" y="${y + 30}" width="${segmentW}" height="16" rx="8" fill="${color}"/>`;
    cursor += segmentW;
    return rect;
  }).join("");
  const legend = rows.slice(0, 4).map((row, index) => {
    const lx = x + index * Math.min(250, Math.floor(width / 4));
    const color = shareMixColor(row, palette.theme);
    return `
      <rect x="${lx}" y="${y + 60}" width="12" height="12" rx="3" fill="${color}"/>
      <text x="${lx + 20}" y="${y + 71}" fill="${palette.text}" font-family="Inter, Segoe UI, Microsoft YaHei, Arial, sans-serif" font-size="15" font-weight="700">${svgText(shortSvgLabel(row.label, 16))} ${svgText(row.shareLabel)}</text>`;
  }).join("");
  return `
  <text x="${x}" y="${y + 4}" fill="${palette.heading}" font-family="Inter, Segoe UI, Microsoft YaHei, Arial, sans-serif" font-size="18" font-weight="800" letter-spacing="1">${svgText(config.title)} / ${svgText(config.subtitle)}</text>
  <rect x="${x}" y="${y + 30}" width="${barW}" height="16" rx="8" fill="${palette.barTrack}"/>
  ${segments || `<text x="${x}" y="${y + 45}" fill="${palette.text}" font-family="Inter, Segoe UI, Microsoft YaHei, Arial, sans-serif" font-size="15">${svgText(config.emptyLabel)}</text>`}
  ${legend}`;
}

function svgShareTapeBar(data, options) {
  const { x, y, width, square, palette = shareThemePalette(), tapeSummary } = options;
  const tape = data.tape.slice(0, shareTapeLimit(square ? "square" : "wide"));
  const summary = tapeSummary ?? shareTapeSummary(tape);
  const cols = square ? 8 : 24;
  const gap = square ? 10 : 10;
  const cell = Math.max(18, Math.floor((width - gap * (cols - 1)) / cols));
  return `
  <text x="${x}" y="${y + 4}" fill="${palette.heading}" font-family="Inter, Segoe UI, Microsoft YaHei, Arial, sans-serif" font-size="18" font-weight="800" letter-spacing="1">${svgText(t("share.recentTape", { count: tape.length }))} / ${svgText(shareCopy("tapeSummary", { wins: summary.wins, losses: summary.losses, unknown: summary.unknown, activity: summary.notApplicable }))}</text>
  ${tape.length
    ? buildShareSvgTape(tape, { x, y: y + 30, cols, cell, gap, palette })
    : `<text x="${x}" y="${y + 49}" fill="${palette.text}" font-family="Inter, Segoe UI, Microsoft YaHei, Arial, sans-serif" font-size="15">${svgText(shareCopy("noTape"))}</text>`}`;
}

function shortSvgLabel(value, limit = 18) {
  const text = String(value ?? "");
  return text.length > limit ? `${text.slice(0, Math.max(0, limit - 1))}\u2026` : text;
}

function svgShareSpotlights(data, options) {
  const { x, y, width, square, palette = shareThemePalette() } = options;
  const stats = shareSpotlightStats(data);
  const gap = square ? 16 : 18;
  const cardW = Math.floor((width - gap * 2) / 3);
  const cardH = square ? 112 : 118;
  return stats.map((stat, index) => {
    const cardX = x + index * (cardW + gap);
    const color = svgMetricColor(stat.value, stat.tone, palette);
    const isNeutral = color === palette.neutral;
    const stroke = isNeutral ? palette.cardStroke : color;
    return `
  <rect x="${cardX}" y="${y}" width="${cardW}" height="${cardH}" rx="16" fill="${palette.cardFill}" stroke="${stroke}" stroke-opacity="${isNeutral ? "1" : "0.32"}" stroke-width="2"/>
  <path d="M ${cardX + cardW - 34} ${y + 16} H ${cardX + cardW - 18} V ${y + 32}" fill="none" stroke="${palette.cardCornerStroke}" stroke-width="3"/>
  <rect x="${cardX}" y="${y}" width="${Math.round(cardW * 0.42)}" height="${cardH}" rx="16" fill="${color}" opacity="${isNeutral ? "0.035" : "0.09"}"/>
  <text x="${cardX + 20}" y="${y + 30}" fill="${palette.text}" font-family="Inter, Segoe UI, Microsoft YaHei, Arial, sans-serif" font-size="16" font-weight="900" letter-spacing="2">${svgText(stat.label).toUpperCase()}</text>
  <text x="${cardX + 20}" y="${y + 78}" fill="${color}" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="${square ? 42 : 48}" font-weight="950" letter-spacing="-2">${svgText(stat.value)}</text>
  <text x="${cardX + 20}" y="${y + cardH - 18}" fill="${palette.muted}" font-family="Inter, Segoe UI, Microsoft YaHei, Arial, sans-serif" font-size="15" font-weight="800">${svgText(stat.note)}</text>`;
  }).join("");
}

function svgAvatar(src, x, y, size, palette = shareThemePalette()) {
  return `
  <rect x="${x}" y="${y}" width="${size}" height="${size}" rx="10" fill="${palette.avatarFill}" stroke="${palette.avatarStroke}" stroke-width="3"/>
  <image href="${escapeAttribute(src)}" x="${x + 8}" y="${y + 8}" width="${size - 16}" height="${size - 16}" preserveAspectRatio="xMidYMid slice" style="image-rendering: pixelated"/>
  <rect x="${x + 8}" y="${y + 8}" width="${size - 16}" height="${size - 16}" fill="none" stroke="${palette.avatarInnerStroke}" stroke-width="2"/>`;
}

function svgMetricColor(value, tone = "", palette = shareThemePalette()) {
  const resolvedTone = metricTone(value, tone);
  if (resolvedTone === "green") return palette.green;
  if (resolvedTone === "red" || resolvedTone === "loss") return palette.red;
  if (resolvedTone === "gold") return palette.gold;
  if (resolvedTone === "blue") return palette.blue;
  if (resolvedTone === "warn") return palette.warn;
  if (resolvedTone === "ignored") return palette.ignored;
  return palette.neutral;
}

function svgShareMetric([label, value, tone], index, columns, x, y, width, height, gap, palette = shareThemePalette()) {
  const column = index % columns;
  const row = Math.floor(index / columns);
  const cellX = x + column * (width + gap);
  const cellY = y + row * (height + gap);
  const color = svgMetricColor(value, tone, palette);
  return `
  <rect x="${cellX}" y="${cellY}" width="${width}" height="${height}" rx="12" fill="${palette.surfaceSoft}" stroke="${palette.border}" stroke-width="2"/>
  <text x="${cellX + 18}" y="${cellY + 28}" fill="${palette.muted}" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="14" font-weight="700" letter-spacing="1">${svgText(label).toUpperCase()}</text>
  <text x="${cellX + 18}" y="${cellY + 70}" fill="${color}" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="28" font-weight="900">${svgText(value)}</text>`;
}


function buildShareSvgTape(tape, options) {
  const { x, y, cols, cell, gap, palette = shareThemePalette() } = options;
  const cells = tape.map((round, index) => {
    const column = index % cols;
    const row = Math.floor(index / cols);
    const cellX = x + column * (cell + gap);
    const cellY = y + row * (cell + gap);
    return `<rect x="${cellX}" y="${cellY}" width="${cell}" height="${cell}" rx="6" fill="${shareResultColor(round.result, palette)}" opacity="${round.result === "unknown" ? "0.72" : "0.92"}"/>`;
  }).join("");
  return cells;
}

function shareResultColor(result, palette = shareThemePalette()) {
  return {
    win: palette.winCell,
    loss: palette.lossCell,
    not_applicable: palette.activityCell,
    ambiguous: palette.unknownCell,
    unknown: palette.unknownCell,
  }[safeResult(result)] ?? palette.unknownCell;
}

function safeResult(result) {
  return ["win", "loss", "unknown", "ambiguous", "not_applicable"].includes(result) ? result : "unknown";
}

function resultTone(result) {
  if (result === "win") return "win";
  if (result === "loss") return "loss";
  if (result === "not_applicable") return "unknown";
  return "unknown";
}

function resultInitial(result) {
  if (result === "win") return "W";
  if (result === "loss") return "L";
  return "?";
}

function pixelMark(size = "") {
  return `
    <img class="pixel-mark ${escapeAttribute(size)}" src="/src/app/assets/app-icon.svg" width="24" height="24" alt="" aria-hidden="true" decoding="async" />
  `;
}

function pixelAvatar(view) {
  const avatar = avatarModel(view);
  return `
    <img class="pixel-avatar" src="${escapeAttribute(avatar.src)}" width="44" height="44" alt="${escapeAttribute(avatar.alt)}" loading="eager" decoding="async" />
  `;
}

function emptyState(message) {
  return `<div class="empty">${escapeHtml(message)}</div>`;
}

function svgText(value) {
  return escapeHtml(value);
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = url;
  });
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Canvas export failed."));
    }, "image/png");
  });
}

async function pngBlobWithDpi(blob, dpi) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (!isPngBytes(bytes)) return blob;
  return new Blob([injectPngPhysChunk(bytes, dpi)], { type: "image/png" });
}

function isPngBytes(bytes) {
  return bytes.length > 8
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47
    && bytes[4] === 0x0d
    && bytes[5] === 0x0a
    && bytes[6] === 0x1a
    && bytes[7] === 0x0a;
}

function injectPngPhysChunk(bytes, dpi) {
  const pixelsPerMeter = Math.max(1, Math.round(dpi / 0.0254));
  const physChunk = createPngPhysChunk(pixelsPerMeter);
  let offset = 8;
  let insertAt = 8;

  while (offset + 12 <= bytes.length) {
    const length = readUint32(bytes, offset);
    const type = pngChunkType(bytes, offset + 4);
    const chunkEnd = offset + 12 + length;
    if (chunkEnd > bytes.length) break;
    if (type === "IHDR") insertAt = chunkEnd;
    if (type === "pHYs") {
      return concatBytes(bytes.slice(0, offset), physChunk, bytes.slice(chunkEnd));
    }
    offset = chunkEnd;
  }

  return concatBytes(bytes.slice(0, insertAt), physChunk, bytes.slice(insertAt));
}

function createPngPhysChunk(pixelsPerMeter) {
  const data = new Uint8Array(9);
  writeUint32(data, 0, pixelsPerMeter);
  writeUint32(data, 4, pixelsPerMeter);
  data[8] = 1;
  return createPngChunk("pHYs", data);
}

function createPngChunk(type, data) {
  const typeBytes = asciiBytes(type);
  const chunk = new Uint8Array(12 + data.length);
  writeUint32(chunk, 0, data.length);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);
  writeUint32(chunk, 8 + data.length, pngCrc32(concatBytes(typeBytes, data)));
  return chunk;
}

function pngChunkType(bytes, offset) {
  return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
}

function asciiBytes(value) {
  return Uint8Array.from(String(value), (char) => char.charCodeAt(0));
}

function readUint32(bytes, offset) {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

function writeUint32(bytes, offset, value) {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}

function concatBytes(...parts) {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  parts.forEach((part) => {
    output.set(part, offset);
    offset += part.length;
  });
  return output;
}

let pngCrcTable = null;
function pngCrc32(bytes) {
  if (!pngCrcTable) {
    pngCrcTable = Array.from({ length: 256 }, (_, index) => {
      let crc = index;
      for (let bit = 0; bit < 8; bit += 1) {
        crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
      }
      return crc >>> 0;
    });
  }

  let crc = 0xffffffff;
  bytes.forEach((byte) => {
    crc = pngCrcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  });
  return (crc ^ 0xffffffff) >>> 0;
}

function safeFilename(value) {
  return String(value ?? "player")
    .trim()
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "player";
}

function avatarModel(view = {}) {
  const avatar = state.avatar ?? {};
  const playerName = view.playerName ?? t("common.player");
  const src = avatar.dataUrl || avatar.url || DEFAULT_AVATAR_URL;
  const label = avatar.type === "official" && avatar.username
    ? t("avatar.sourceUsername", { username: avatar.username })
    : avatar.type === "username" && avatar.username
    ? t("avatar.sourceUsername", { username: avatar.username })
    : avatar.type === "upload"
      ? t("avatar.sourceUpload")
      : t("avatar.sourceDefault");
  return {
    src,
    label,
    alt: t("avatar.alt", { player: playerName }),
  };
}

function readStoredAvatar() {
  try {
    const stored = JSON.parse(localStorage.getItem(AVATAR_STORAGE_KEY) ?? "null");
    if (!stored || typeof stored !== "object") return defaultAvatarState();
    if (stored.type === "upload" && typeof stored.dataUrl === "string" && stored.dataUrl.startsWith("data:image/")) {
      return { type: "upload", username: "", url: DEFAULT_AVATAR_URL, dataUrl: stored.dataUrl };
    }
    if (stored.type === "official" && typeof stored.username === "string" && typeof stored.dataUrl === "string" && stored.dataUrl.startsWith("data:image/")) {
      return {
        type: "official",
        username: stored.username,
        uuid: typeof stored.uuid === "string" ? stored.uuid : "",
        skinUrl: typeof stored.skinUrl === "string" ? stored.skinUrl : "",
        model: stored.model === "slim" ? "slim" : "classic",
        url: stored.skinUrl || DEFAULT_AVATAR_URL,
        dataUrl: stored.dataUrl,
      };
    }
    if (stored.type === "username" && typeof stored.username === "string" && typeof stored.dataUrl === "string") {
      return { type: "username", username: stored.username, url: stored.url || DEFAULT_AVATAR_URL, dataUrl: stored.dataUrl };
    }
    return defaultAvatarState();
  } catch {
    return defaultAvatarState();
  }
}

function readStoredPlayerProfile() {
  try {
    const stored = JSON.parse(localStorage.getItem(PLAYER_PROFILE_STORAGE_KEY) ?? "null");
    if (!stored || typeof stored !== "object") return defaultPlayerProfileState();
    const displayName = typeof stored.displayName === "string" ? stored.displayName.trim() : "";
    if (!displayName) return defaultPlayerProfileState();
    return {
      displayName,
      source: stored.source === "custom" || stored.source === "alias" || stored.source === "official" ? stored.source : "custom",
      updatedAt: typeof stored.updatedAt === "string" ? stored.updatedAt : "",
    };
  } catch {
    return defaultPlayerProfileState();
  }
}

function defaultAvatarState() {
  return {
    type: "default",
    username: "",
    url: DEFAULT_AVATAR_URL,
    dataUrl: "",
  };
}

function defaultPlayerProfileState() {
  return {
    displayName: "",
    source: "auto",
    updatedAt: "",
  };
}

function storeAvatar() {
  try {
    localStorage.setItem(AVATAR_STORAGE_KEY, JSON.stringify(state.avatar));
  } catch {
    // Avatar persistence is optional; keep the current in-memory avatar.
  }
}

function storePlayerProfile() {
  try {
    localStorage.setItem(PLAYER_PROFILE_STORAGE_KEY, JSON.stringify(state.playerProfile));
  } catch {
    // Profile persistence is optional; keep the current in-memory name.
  }
}

async function loadAvatarFromUsername(username) {
  const cleanName = normalizeDisplayName(username);
  state.playerProfile = {
    displayName: cleanName,
    source: "custom",
    updatedAt: new Date().toISOString(),
  };
  storePlayerProfile();

  try {
    assertMinecraftUsername(cleanName);
    const profile = await getJson(`/api/minecraft-profile?username=${encodeURIComponent(cleanName)}`);
    const dataUrl = await minecraftHeadDataUrl(profile.skinUrl);
    state.playerProfile = {
      displayName: profile.name || cleanName,
      source: "official",
      updatedAt: new Date().toISOString(),
    };
    state.avatar = {
      type: "official",
      username: profile.name || cleanName,
      uuid: profile.uuid || profile.id || "",
      skinUrl: profile.skinUrl,
      model: profile.model === "slim" ? "slim" : "classic",
      url: profile.skinUrl,
      dataUrl,
    };
    state.avatarFallback = null;
    storePlayerProfile();
    storeAvatar();
  } catch (error) {
    state.avatarFallback = {
      username: cleanName,
      message: error.code === "invalid_minecraft_username" ? t("avatar.invalidName") : error.message || error.code || t("common.unknown"),
    };
    throw error;
  }
}

function normalizeDisplayName(username) {
  const cleanName = String(username ?? "").trim();
  if (!cleanName || cleanName.length > 32) {
    const error = new Error("Invalid display name.");
    error.code = "invalid_display_name";
    throw error;
  }
  return cleanName;
}

function assertMinecraftUsername(username) {
  if (/^[A-Za-z0-9_]{1,16}$/.test(username)) return;
  const error = new Error("Invalid Minecraft username.");
  error.code = "invalid_minecraft_username";
  throw error;
}

async function minecraftHeadDataUrl(skinUrl) {
  const image = await loadImageWithCors(skinUrl);
  const canvas = document.createElement("canvas");
  const scale = 8;
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  context.imageSmoothingEnabled = false;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 8, 8, 8, 8, 0, 0, 8 * scale, 8 * scale);
  context.drawImage(image, 40, 8, 8, 8, 0, 0, 8 * scale, 8 * scale);
  return canvas.toDataURL("image/png");
}

function loadImageWithCors(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Image load failed."));
    image.src = url;
  });
}

function applyUploadedAvatar(dataUrl) {
  const fallbackName = state.avatarFallback?.username;
  const currentName = state.playerProfile.displayName || fallbackName;
  if (currentName) {
    state.playerProfile = {
      displayName: currentName,
      source: state.playerProfile.source === "auto" ? "custom" : state.playerProfile.source,
      updatedAt: new Date().toISOString(),
    };
    storePlayerProfile();
  }
  state.avatar = {
    type: "upload",
    username: "",
    url: DEFAULT_AVATAR_URL,
    dataUrl,
  };
  state.avatarFallback = null;
  storeAvatar();
}

async function loadAvatarFromFile(file) {
  if (!file || !file.type?.startsWith("image/")) throw new Error("Invalid image file.");
  const dataUrl = await fileToDataUrl(file);
  applyUploadedAvatar(dataUrl);
}

function resetAvatar() {
  state.avatar = defaultAvatarState();
  state.avatarFallback = null;
  storeAvatar();
}

async function imageUrlToDataUrl(url) {
  const response = await fetch(url, { mode: "cors" });
  if (!response.ok) throw new Error(`Avatar returned ${response.status}`);
  const blob = await response.blob();
  return fileToDataUrl(blob);
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function buildContributionCalendar(rows, windowIndex = 0) {
  const rowsByDate = new Map();

  for (const row of rows) {
    const date = normalizeIsoDate(row?.date ?? row?.period);
    if (!date) continue;
    const current = rowsByDate.get(date) ?? {
      date,
      playtimeSeconds: 0,
      totalRounds: 0,
      reliableRounds: 0,
    };
    current.playtimeSeconds += Number(row.playtimeSeconds ?? 0);
    current.totalRounds += timeSeriesRoundCount(row, "total");
    current.reliableRounds += timeSeriesRoundCount(row, "reliable");
    rowsByDate.set(date, current);
  }

  const activeDates = [...rowsByDate.values()]
    .filter((day) => day.playtimeSeconds > 0 || day.totalRounds > 0 || day.reliableRounds > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  const latestDate = activeDates.at(-1)?.date ?? normalizeIsoDate(new Date().toISOString());
  const earliestDate = activeDates[0]?.date ?? latestDate;
  const latestWeekStart = startOfIsoWeek(parseIsoDate(latestDate));
  const earliestWeekStart = startOfIsoWeek(parseIsoDate(earliestDate));
  const totalWeeks = Math.max(1, Math.floor((latestWeekStart - earliestWeekStart) / (7 * 24 * 60 * 60 * 1000)) + 1);
  const maxWindowIndex = Math.max(0, Math.ceil(totalWeeks / 13) - 1);
  const currentWindowIndex = Math.min(Math.max(0, Number(windowIndex) || 0), maxWindowIndex);
  const endWeekStart = addUtcDays(latestWeekStart, -currentWindowIndex * 13 * 7);
  const startWeekStart = addUtcDays(endWeekStart, -12 * 7);
  const weeks = [];
  const summary = {
    activeDays: 0,
    playtimeSeconds: 0,
    totalRounds: 0,
    reliableRounds: 0,
  };

  for (let weekIndex = 0; weekIndex < 13; weekIndex += 1) {
    const weekStart = addUtcDays(startWeekStart, weekIndex * 7);
    const days = [];

    for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
      const dateObject = addUtcDays(weekStart, dayIndex);
      const date = formatIsoDate(dateObject);
      const source = rowsByDate.get(date);
      const playtimeSeconds = source?.playtimeSeconds ?? 0;
      const totalRounds = source?.totalRounds ?? 0;
      const reliableRounds = source?.reliableRounds ?? 0;
      const isEmpty = playtimeSeconds <= 0 && totalRounds <= 0 && reliableRounds <= 0;

      if (!isEmpty) {
        summary.activeDays += 1;
        summary.playtimeSeconds += playtimeSeconds;
        summary.totalRounds += totalRounds;
        summary.reliableRounds += reliableRounds;
      }

      days.push({
        date,
        dayOfMonth: dateObject.getUTCDate(),
        playtimeSeconds,
        totalRounds,
        reliableRounds,
        playtime: isEmpty ? "0s" : formatDurationFromSeconds(playtimeSeconds),
        level: heatLevel(playtimeSeconds, totalRounds || reliableRounds),
        isEmpty,
      });
    }

    weeks.push({
      startDate: formatIsoDate(weekStart),
      days,
    });
  }

  return {
    weeks,
    monthLabels: buildContributionMonthLabels(weeks),
    weekdayLabels: t("calendar.weekdays"),
    summary,
    windowIndex: currentWindowIndex,
    maxWindowIndex,
    rangeStart: weeks[0]?.days[0]?.date ?? latestDate,
    rangeEnd: weeks.at(-1)?.days.at(-1)?.date ?? latestDate,
  };
}

function clampHeatmapWindowIndex(value) {
  const calendar = buildContributionCalendar(state.daySeries?.items ?? [], value);
  return calendar.windowIndex;
}

function timeSeriesRoundCount(row, kind) {
  if (kind === "total") {
    return Number(row.totalRounds ?? row.rounds?.total ?? row.roundsTotal ?? row.reliableRounds ?? 0);
  }
  return Number(row.reliableRounds ?? row.rounds?.reliable ?? row.rounds?.reliableRounds ?? 0);
}

function buildContributionMonthLabels(weeks) {
  const weekMonths = weeks.map((week) => {
    const monthStart = week.days.find((day) => day.dayOfMonth === 1);
    return monthKey(monthStart ?? week.days[0]);
  });
  const labels = [];

  for (let index = 0; index < weekMonths.length; index += 1) {
    if (index > 0 && weekMonths[index] === weekMonths[index - 1]) continue;
    const nextIndex = weekMonths.findIndex((month, lookupIndex) => lookupIndex > index && month !== weekMonths[index]);
    labels.push({
      column: index + 1,
      span: (nextIndex === -1 ? weekMonths.length : nextIndex) - index,
      label: monthName(weekMonths[index]),
    });
  }

  return labels;
}

function monthKey(day) {
  return day.date.slice(0, 7);
}

function monthName(key) {
  const [year, month] = key.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, 1));
  return new Intl.DateTimeFormat(localeCode(), { month: "short", timeZone: "UTC" }).format(date);
}

function normalizeIsoDate(value) {
  const candidate = String(value ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return null;
  const parsed = parseIsoDate(candidate);
  return Number.isNaN(parsed.getTime()) ? null : candidate;
}

function parseIsoDate(date) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function addUtcDays(date, days) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days));
}

function startOfIsoWeek(date) {
  const weekday = date.getUTCDay();
  const offset = weekday === 0 ? -6 : 1 - weekday;
  return addUtcDays(date, offset);
}

function formatIsoDate(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function heatLevel(seconds, rounds) {
  const score = Math.max(seconds / 3600, rounds * 0.7);
  if (score >= 8) return 4;
  if (score >= 4) return 3;
  if (score >= 1.5) return 2;
  if (score > 0) return 1;
  return 0;
}

function buildServerIdentityRows(rounds = [], activitySegments = []) {
  const identities = new Map();

  for (const round of rounds) {
    if (!hasTrustedServerIdentity(round)) continue;
    const names = Object.keys(round.serverPlayerIds ?? round.ownerAliasesUsed ?? {});
    for (const name of names) {
      const normalizedName = normalizeServerIdentityName(name);
      if (!normalizedName || normalizedName === "unknown") continue;
      const row = serverIdentityRow(identities, normalizedName);
      const evidence = Number(round.serverPlayerIds?.[name] ?? round.ownerAliasesUsed?.[name] ?? 1);
      row.evidence += Number.isFinite(evidence) ? evidence : 1;
      row.rounds += 1;
      row.durationSeconds += Number(round.durationSeconds ?? 0);
      row.sources.add(round.source);
      row.scopes.add(scopeKeyValue(round.source, round.scope));
      row.firstSeenAt = earlierDate(row.firstSeenAt, round.startAt);
      row.lastSeenAt = laterDate(row.lastSeenAt, round.endAt ?? round.startAt);
      if (round.serverPlayerIdSource === "direct_self_event") row.direct += 1;
      if (round.serverPlayerIdSource === "play_segment_propagation") row.propagated += 1;
      if (round.result === "win") row.wins += 1;
      else if (round.result === "loss") row.losses += 1;
      else row.unknown += 1;
    }
  }

  for (const segment of activitySegments) {
    if (!hasTrustedServerIdentity(segment)) continue;
    const names = Object.keys(segment.serverPlayerIds ?? segment.serverPlayerIdsDirect ?? {});
    for (const name of names) {
      const normalizedName = normalizeServerIdentityName(name);
      if (!normalizedName || normalizedName === "unknown") continue;
      const row = serverIdentityRow(identities, normalizedName);
      const evidence = Number(segment.serverPlayerIds?.[name] ?? segment.serverPlayerIdsDirect?.[name] ?? 1);
      row.evidence += Number.isFinite(evidence) ? evidence : 1;
      row.segments += 1;
      row.durationSeconds += Number(segment.durationSeconds ?? 0);
      row.sources.add(segment.source);
      row.scopes.add(scopeKeyValue(segment.source, segment.scope));
      row.firstSeenAt = earlierDate(row.firstSeenAt, segment.startAt);
      row.lastSeenAt = laterDate(row.lastSeenAt, segment.endAt ?? segment.startAt);
      if (segment.serverPlayerIdSource === "direct_self_event") row.direct += 1;
      if (segment.serverPlayerIdSource === "play_segment_propagation") row.propagated += 1;
    }
  }

  return [...identities.values()]
    .map((row) => ({
      ...row,
      sources: [...row.sources].sort(),
      scopes: [...row.scopes].sort(),
      scopeCount: row.scopes.size,
      duration: formatDurationFromSeconds(row.durationSeconds),
    }))
    .sort((a, b) =>
      b.rounds - a.rounds
      || b.direct - a.direct
      || b.evidence - a.evidence
      || b.segments - a.segments
      || a.name.localeCompare(b.name),
    );
}

function hasTrustedServerIdentity(row = {}) {
  if (!row.serverPlayerIds || !Object.keys(row.serverPlayerIds).length) return false;
  if (row.serverPlayerIdSource === "launcher_user_fallback") return false;
  if (row.serverPlayerIdConfidence === "none") return false;
  return true;
}

function serverIdentityRow(rows, rawName) {
  const name = normalizeServerIdentityName(rawName);
  return getGroup(rows, name, () => ({
    name,
    evidence: 0,
    rounds: 0,
    segments: 0,
    direct: 0,
    propagated: 0,
    wins: 0,
    losses: 0,
    unknown: 0,
    durationSeconds: 0,
    sources: new Set(),
    scopes: new Set(),
    firstSeenAt: null,
    lastSeenAt: null,
  }));
}

function normalizeServerIdentityName(value) {
  return String(value ?? "").trim();
}

function scopeKeyValue(source, scope) {
  return `${source ?? t("common.local")}\u0000${scope ?? "(root)"}`;
}

function earlierDate(current, candidate) {
  if (!candidate) return current;
  if (!current) return candidate;
  return candidate < current ? candidate : current;
}

function laterDate(current, candidate) {
  if (!candidate) return current;
  if (!current) return candidate;
  return candidate > current ? candidate : current;
}

function profileAliasOptions(view) {
  const aliases = [
    ...view.serverIdentityRows.map((identity) => identity.name),
    ...(view.owner.aliases ?? []),
    ...(view.owner.localUsers ?? []),
    ...view.accountRows.map((account) => account.user),
  ].filter((name) => name && name !== "unknown");
  return unique(aliases);
}

function pickDisplayName(owner, accountRows, playerProfile = {}) {
  const ownerNames = [...(owner.aliases ?? []), ...(owner.localUsers ?? [])]
    .filter((name) => name && name !== "unknown");
  const ownerDisplayName = owner.displayName && owner.displayName !== "Owner" ? owner.displayName : null;
  const selectedDisplayName = playerProfile.displayName?.trim() || null;
  return selectedDisplayName
    ?? ownerDisplayName
    ?? ownerNames[0]
    ?? accountRows.find((account) => account.user && account.user !== "unknown")?.user
    ?? t("common.player");
}

function modeLabel(id) {
  const modes = state.modesData?.items ?? state.summary?.rounds?.gameModes ?? {};
  return modes[id]?.label ?? id ?? t("common.unknown");
}

function optionLabel(name, value) {
  if (name === "result") return resultLabel(value);
  if (name === "mode") return modeLabel(value);
  return value;
}

function resultLabel(result) {
  return t(`results.${result}`, {}, result ?? t("common.unknown"));
}

function displayScope(value) {
  const scope = String(value ?? "(root)");
  return scope.split("\u0000").at(-1) || "(root)";
}

function formatRatio(numerator, denominator) {
  if (!Number(denominator)) return formatNumber(numerator);
  return (Number(numerator ?? 0) / Number(denominator)).toFixed(2);
}

function formatNumber(value) {
  return Number(value ?? 0).toLocaleString(localeCode());
}

function finiteNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return 0;
}

function parseDurationText(value) {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return 0;
  let total = 0;
  for (const match of text.matchAll(/(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|m|min|mins|minute|minutes|s|sec|secs|second|seconds)\b/g)) {
    const amount = Number(match[1]);
    if (!Number.isFinite(amount)) continue;
    const unit = match[2];
    if (unit.startsWith("h")) total += amount * 3600;
    else if (unit.startsWith("m")) total += amount * 60;
    else total += amount;
  }
  return Math.round(total);
}

function percent(value) {
  return `${Math.round((Number(value) || 0) * 100)}%`;
}

function formatSize(sizeMb) {
  const value = Number(sizeMb ?? 0);
  if (!value) return "0MB";
  return value >= 1024 ? `${(value / 1024).toFixed(1)}GB` : `${value.toFixed(1)}MB`;
}

function formatDateTime(value) {
  const date = safeDate(value);
  if (!date) return t("common.unknown");
  return new Intl.DateTimeFormat(localeCode(), {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatDate(value) {
  const date = safeDate(value);
  if (!date) return t("common.unknown");
  return new Intl.DateTimeFormat(localeCode(), {
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function safeDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function readStoredWinStreakPolicy() {
  try {
    return localStorage.getItem(WIN_STREAK_POLICY_STORAGE_KEY) === "skipUnknown" ? "skipUnknown" : "breakUnknown";
  } catch {
    return "breakUnknown";
  }
}

function storeWinStreakPolicy(policy) {
  try {
    localStorage.setItem(WIN_STREAK_POLICY_STORAGE_KEY, policy === "skipUnknown" ? "skipUnknown" : "breakUnknown");
  } catch {
    // Ignore storage failures; the backend still exposes both policies.
  }
}

function normalizeShareStatSlots(slots, fallbackToDefault = false) {
  const source = Array.isArray(slots) ? slots : DEFAULT_SHARE_STAT_SLOTS;
  const seen = new Set();
  const normalized = [];
  for (const key of source) {
    if (!SHARE_STAT_OPTION_KEYS.includes(key) || seen.has(key)) continue;
    seen.add(key);
    normalized.push(key);
    if (normalized.length >= SHARE_STAT_SLOT_LIMIT) break;
  }
  if (normalized.length) return normalized;
  return fallbackToDefault ? DEFAULT_SHARE_STAT_SLOTS.slice(0, SHARE_STAT_SLOT_LIMIT) : [];
}

function readStoredShareStatSlots() {
  try {
    return normalizeShareStatSlots(JSON.parse(localStorage.getItem(SHARE_STAT_SLOTS_STORAGE_KEY) || "null"), true);
  } catch {
    return DEFAULT_SHARE_STAT_SLOTS.slice(0, SHARE_STAT_SLOT_LIMIT);
  }
}

function storeShareStatSlots(slots) {
  state.shareStatSlots = normalizeShareStatSlots(slots, false);
  try {
    localStorage.setItem(SHARE_STAT_SLOTS_STORAGE_KEY, JSON.stringify(state.shareStatSlots));
  } catch {
    // Ignore storage failures; the current card still reflects the new order.
  }
}

function formatDurationFromSeconds(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds ?? 0)));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainingSeconds = total % 60;
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m`;
  return `${remainingSeconds}s`;
}

function formatDurationFromMilliseconds(milliseconds) {
  return formatDurationFromSeconds(Math.floor(Number(milliseconds ?? 0) / 1000));
}

function shortPath(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  return text.split(/[\\/]/).filter(Boolean).slice(-4).join(" / ");
}

function normalizeSearch(value) {
  return String(value ?? "").normalize("NFKC").trim().toLowerCase();
}

function t(path, vars = {}, fallback = "") {
  const value = path.split(".").reduce((current, key) => current?.[key], I18N[state.locale] ?? I18N.zh);
  if (Array.isArray(value)) return value;
  const template = typeof value === "string" ? value : fallback || path;
  return template.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? "");
}

function localeCode() {
  return state.locale === "en" ? "en-US" : "zh-CN";
}

function applyTheme() {
  document.documentElement.dataset.theme = state.theme === "light" ? "light" : "dark";
}

function systemThemeName() {
  try {
    return window.matchMedia?.("(prefers-color-scheme: light)")?.matches ? "light" : "dark";
  } catch {
    return "dark";
  }
}

function readThemePreference() {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
  } catch {
    return "system";
  }
}

function readStoredTheme() {
  const preference = readThemePreference();
  return preference === "system" ? systemThemeName() : preference;
}

function storeThemePreference(theme) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme === "light" || theme === "dark" ? theme : "system");
  } catch {
    // Ignore storage failures; the in-memory theme switch still works.
  }
}

function normalizeThemePreference(theme) {
  return theme === "light" || theme === "dark" ? theme : "system";
}

function readAuditOobeDismissed() {
  try {
    return localStorage.getItem(AUDIT_OOBE_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function storeAuditOobeDismissed() {
  try {
    localStorage.setItem(AUDIT_OOBE_STORAGE_KEY, "1");
  } catch {
    // Ignore storage failures; the guide can still be dismissed for this render.
  }
}

function installSystemThemeSync() {
  try {
    const query = window.matchMedia?.("(prefers-color-scheme: light)");
    if (!query) return;
    const syncTheme = () => {
      if (readThemePreference() !== "system") return;
      const nextTheme = systemThemeName();
      if (state.theme === nextTheme) return;
      state.theme = nextTheme;
      if (state.loading.initial) {
        renderLoading();
      } else if (state.setupMode) {
        renderSetup();
      } else {
        renderFrame();
      }
    };
    if (typeof query.addEventListener === "function") {
      query.addEventListener("change", syncTheme);
    } else if (typeof query.addListener === "function") {
      query.addListener(syncTheme);
    }
  } catch {
    // Theme following is an enhancement; the explicit toggle still works.
  }
}

function readStoredLocale() {
  try {
    return localStorage.getItem("mc-log-locale") === "en" ? "en" : "zh";
  } catch {
    return "zh";
  }
}

function storeLocale(locale) {
  try {
    localStorage.setItem("mc-log-locale", locale);
  } catch {
    // Ignore storage failures; the in-memory language switch still works.
  }
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function getGroup(map, key, create) {
  if (!map.has(key)) map.set(key, create());
  return map.get(key);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("'", "&#39;");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
