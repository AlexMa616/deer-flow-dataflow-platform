import logging
import re
import subprocess
from urllib.parse import urljoin

from markdownify import markdownify as md
from readabilipy import simple_json_from_html_string

logger = logging.getLogger(__name__)


class Article:
    url: str

    def __init__(self, title: str, html_content: str):
        self.title = title
        self.html_content = html_content

    def to_markdown(self, including_title: bool = True) -> str:
        markdown = ""
        if including_title:
            markdown += f"# {self.title}\n\n"

        if self.html_content is None or not str(self.html_content).strip():
            markdown += "*No content available*\n"
        else:
            markdown += md(self.html_content)

        return markdown

    def to_message(self) -> list[dict]:
        image_pattern = r"!\[.*?\]\((.*?)\)"

        content: list[dict[str, str]] = []
        markdown = self.to_markdown()

        if not markdown or not markdown.strip():
            return [{"type": "text", "text": "No content available"}]

        parts = re.split(image_pattern, markdown)

        for i, part in enumerate(parts):
            if i % 2 == 1:
                image_url = urljoin(self.url, part.strip())
                content.append({"type": "image_url", "image_url": {"url": image_url}})
            else:
                text_part = part.strip()
                if text_part:
                    content.append({"type": "text", "text": text_part})

        # If after processing all parts, content is still empty, provide a fallback message.
        if not content:
            content = [{"type": "text", "text": "No content available"}]

        return content


class ReadabilityExtractor:
    def extract_article(self, html: str) -> Article:
        article: dict | None = None

        try:
            article = simple_json_from_html_string(html, use_readability=True)
        except (subprocess.CalledProcessError, FileNotFoundError) as exc:
            logger.warning(
                "Readability parser unavailable, falling back to basic HTML extraction: %s",
                exc,
            )
        except Exception as exc:
            logger.warning(
                "Readability parser failed, falling back to basic HTML extraction: %s",
                exc,
            )

        if article is None:
            try:
                article = simple_json_from_html_string(html, use_readability=False)
            except Exception as exc:
                logger.warning(
                    "Basic HTML extraction failed, falling back to raw HTML: %s",
                    exc,
                )
                article = {}

        html_content = article.get("content") if isinstance(article, dict) else None
        if not html_content or not str(html_content).strip():
            html_content = html

        title = article.get("title") if isinstance(article, dict) else None
        if not title or not str(title).strip():
            match = re.search(r"<title[^>]*>(.*?)</title>", html, flags=re.I | re.S)
            title = re.sub(r"\s+", " ", match.group(1)).strip() if match else "Untitled"

        return Article(title=title, html_content=html_content)
