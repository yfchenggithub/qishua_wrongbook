import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

export default function LibraryScreen() {
  const router = useRouter();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>题库</Text>
      <Text style={styles.description}>所有错题将在这里展示</Text>

      <Pressable style={styles.button} onPress={() => router.push('/mistake/demo-1' as never)}>
        <Text style={styles.buttonText}>查看示例错题</Text>
      </Pressable>
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
  button: {
    marginTop: 24,
    alignSelf: 'flex-start',
    backgroundColor: '#111',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  buttonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
});
