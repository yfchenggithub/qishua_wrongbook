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

function hasPlugin(plugins, pluginName) {
  return plugins.some((plugin) => (
    plugin === pluginName || (Array.isArray(plugin) && plugin[0] === pluginName)
  ));
}

module.exports = ({ config }) => {
  const plugins = Array.isArray(config.plugins) ? config.plugins : [];
  return {
    ...config,
    plugins: hasPlugin(plugins, 'expo-background-task')
      ? plugins
      : [...plugins, 'expo-background-task'],
    extra: {
      ...config.extra,
      buildDate: getShanghaiBuildDate(),
    },
  };
};
