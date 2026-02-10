export type StyleMode = "stable" | "preview" | "unstable";

export type BlackOptions = {
  line_length: number;
  target_versions: string[];
  fast: boolean;
  skip_source_first_line: boolean;
  skip_string_normalization: boolean;
  skip_magic_trailing_comma: boolean;
  is_pyi: boolean;
  style: StyleMode;
};

export type PlaygroundState = {
  code: string;
  options: BlackOptions;
};
