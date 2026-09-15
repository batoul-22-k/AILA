"""Development-only utility for summarizing local LLM debug exports."""

from app.debug_export import write_model_comparison_summary


def main() -> None:
    json_path, csv_path = write_model_comparison_summary()
    print(f"Wrote {json_path}")
    print(f"Wrote {csv_path}")


if __name__ == "__main__":
    main()
