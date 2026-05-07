import { StyleSheet, Text, View } from 'react-native';

export default function AddScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>新增</Text>
      <Text style={styles.description}>拍照录入错题将在这里完成</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 24,
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#111',
  },
  description: {
    marginTop: 12,
    fontSize: 16,
    color: '#666',
  },
});
