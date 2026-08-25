import {
  Button,
  useComputedColorScheme,
  useMantineColorScheme,
} from "@mantine/core";

export function ColorSchemeToggle() {
  const colorScheme = useComputedColorScheme("light", {
    getInitialValueInEffect: true,
  });
  const { setColorScheme } = useMantineColorScheme();
  const nextColorScheme = colorScheme === "dark" ? "light" : "dark";

  return (
    <Button
      size="compact-sm"
      variant="default"
      onClick={() => setColorScheme(nextColorScheme)}
    >
      {nextColorScheme === "dark" ? "Dark mode" : "Light mode"}
    </Button>
  );
}
