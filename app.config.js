function getShanghaiBuildDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: '2-digit',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const valueByType = Object.fromEntries(parts.map(({ type, value }) => [type, value]));

  return `${valueByType.year}.${valueByType.month}.${valueByType.day}`;
}

module.exports = ({ config }) => ({
  ...config,
  extra: {
    ...config.extra,
    buildDate: getShanghaiBuildDate(),
  },
});
