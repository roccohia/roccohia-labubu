/**
 * 小红书监控配置
 */
export const xhsConfig = {
  searchKeyword: 'labubu',
  matchKeywords: [
    'sg', '新加坡', '🇸🇬', '补货', '发售', '突击',
    'slabubu', 'sglabubu', 'sg-labubu', 'sg_labubu', 'sg labubu'
  ],
  seenPostsFile: 'xhs-seen-posts.json',
  cookiesFile: 'xhs-cookies.json',
};

/**
 * 新加坡 Pop Mart 监控配置
 */
export const sgpmConfig = {
  productUrls: [
    'https://www.popmart.com/sg/products/3877/THE-MONSTERS-Wacky-Mart-Series-Earphone-Case',
    'https://www.popmart.com/sg/products/1149/LABUBU-HIDE-AND-SEEK-IN-SINGAPORE-SERIES-Vinyl-Plush-Doll-Pendant',
    'https://www.popmart.com/sg/products/1712/THE-MONSTERS-COCA-COLA-SERIES-Vinyl-Face-Blind-Box',
    'https://www.popmart.com/sg/pop-now/set/100',
  ],
  statusFile: 'sgpm-products-status.json',
}; 