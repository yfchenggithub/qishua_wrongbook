import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

export default function MistakeDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const currentId = Array.isArray(id) ? id[0] : id ?? 'unknown';

  return (
    <View style={styles.container}>
      <Pressable style={styles.backButton} onPress={() => router.back()}>
        <Text style={styles.backButtonText}>返回</Text>
      </Pressable>

      <Text style={styles.title}>错题详情</Text>
      <Text style={styles.idText}>当前 id：{currentId}</Text>
      <Text style={styles.description}>错题详情和复做记录将在这里展示</Text>
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
  backButton: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  backButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111',
  },
  title: {
    marginTop: 20,
    fontSize: 28,
    fontWeight: '700',
    color: '#111',
  },
  idText: {
    marginTop: 12,
    fontSize: 16,
    color: '#333',
  },
  description: {
    marginTop: 12,
    fontSize: 16,
    color: '#666',
  },
});
