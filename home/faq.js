const faqItems = document.querySelectorAll(".faq-item");

faqItems.forEach(item=>{

    const question=item.querySelector(".faq-question");

    question.onclick=()=>{

        item.classList.toggle("active");

    };

});
