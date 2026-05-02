from PIL import Image, ImageDraw, ImageFont
import os

from task import celery_app

if __name__ == "__main__":
    celery_app.start()

@celery_app.task(name="process_image")
def process_image(input_path, job_id):
    try:
        output_path = input_path.replace("_raw", "_watermarked")
        
        with Image.open(input_path) as img:
            draw = ImageDraw.Draw(img)

            text = "MY PROPERTY"
            
            width, height = img.size
            draw.text((10, height - 30), text, fill=(255, 255, 255))
            
            img.save(output_path)
            
        return {"output_path": output_path}
    except Exception as e:
        return {"error": str(e)}