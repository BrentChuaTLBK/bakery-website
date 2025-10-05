// Configuration - Update this with your Render API URL
const API_BASE_URL = "https://tlbk-api.onrender.com/api"; // Render API URL (no trailing slash!)

var urlParams = new URLSearchParams(window.location.search);
var blogId = urlParams.get("blog");

fetch(`${API_BASE_URL}/findOne`, {
    method: "POST",
    headers: {
        "Content-Type": "application/json",
    },
    body: JSON.stringify({
        collection: "blogs",
        filter: {
            "id": blogId
        }
    })
})
    .then((response) => response.json())
    .then((result) => {
        console.log(result);
        const blogPost = result.document;
                const title = blogPost.title;
                const content = blogPost.content;

                let htmlContent =
                    `<h1 class="fw-bold blog-title" style="font-family: Lobster, serif;">` + title + `</h1>`
                let blogsContainer = document.querySelector(".blog-title");
                blogsContainer.innerHTML = htmlContent;

                document.querySelector(".blog-content").innerHTML =
                    `<p class="blog-content" style="text-align: justify;">` + content + `</p>`;
                $(".loading").hide();
            })
            .catch((e) => {
                console.log(e);
                $(".loading").hide();
            });
