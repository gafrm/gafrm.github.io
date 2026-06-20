```{=html}
<div class="apero-blog-grid list">
<%
function formatDate(dateValue) {
  if (!dateValue) return "";
  const date = new Date(dateValue);
  if (isNaN(date)) return dateValue;
  return date.toLocaleDateString("en-CA", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).toUpperCase();
}
%>

<% for (const item of items) { %>
  <article class="apero-blog-card" <%= metadataAttrs(item) %>>
    <a class="apero-blog-card-link" href="<%- item.path %>">

      <% if (item.image) { %>
        <div class="apero-blog-card-image-wrap">
          <img
            class="apero-blog-card-image"
            src="<%- item.image %>"
            alt="<%- item['image-alt'] || item.title || '' %>"
          />
        </div>
      <% } %>

      <div class="apero-blog-card-body">
        <h2 class="apero-blog-card-title listing-title">
          <%- item.title %>
        </h2>

        <% if (item.description) { %>
          <p class="apero-blog-card-description listing-description">
            <%- item.description %>
          </p>
        <% } %>

        <% if (item.date) { %>
          <p class="apero-blog-card-date listing-date">
            <%- formatDate(item.date) %>
          </p>
        <% } %>
      </div>

    </a>
  </article>
<% } %>
</div>
```